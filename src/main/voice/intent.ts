// Transcript → VoiceCommand via Groq (OpenAI-compatible chat completions,
// JSON mode). The LLM does the fuzzy name→id resolution: it sees the full
// names+ids snapshot and must answer with ids only. Shape validation happens
// here (validateVoiceCommand); id existence is the renderer's job.
import { validateVoiceCommand, type VoiceCommand, type WorkspaceSnapshot } from '@shared/voice'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export type IntentErrorKind = 'network' | 'auth' | 'rate-limit' | 'timeout'
export class VoiceIntentError extends Error {
  constructor(public kind: IntentErrorKind, message: string) {
    super(message)
    this.name = 'VoiceIntentError'
  }
}

export interface ChatMessage { role: 'system' | 'user'; content: string }

export function buildIntentMessages(transcript: string, snapshot: WorkspaceSnapshot): [ChatMessage, ChatMessage] {
  const system = `You convert a voice command for a terminal-manager app into ONE JSON object.
The user speaks Serbian (latinica), English, or a mix. Workspace structure (projects = groups):

${JSON.stringify(snapshot, null, 1)}

Reply with ONLY a JSON object, no prose, shaped as:
{"action": "switch_feature|toggle_grid|switch_tab|set_grid_style|hide_terminal|add_terminal|close_terminal|rename_feature|rename_terminal|send_prompt|cycle_tab|close_tabs|add_feature|archive_feature|review_accept|review_more_rounds|review_stop|unknown",
 "featureId"?: string, "terminalId"?: string, "groupId"?: string, "kind"?: "shell|claude|codex",
 "prompt"?: string, "name"?: string,
 "gridStyle"?: "auto|auto-left|auto-top|auto-bottom|rows|cols",
 "direction"?: "next|prev", "scope"?: "others|left|right",
 "confidence": "high|low"}

Rules:
- Resolve spoken names fuzzily against the snapshot names (they may be mangled by speech-to-text, e.g. "fajl pejns" = "file-panes") and answer with the matching IDS from the snapshot, never names.
- When no feature/terminal is named, use activeFeatureId / activeTerminalId.
- Ordinal tab references ("drugi tab", "third tab") count only terminals WITHOUT "hidden": true, in snapshot order, within the active feature. The app may also show open file panes as tabs AFTER the terminals — those are not in the snapshot and cannot be voice targets; if an ordinal exceeds the visible terminal count, use action "unknown".
- "close/zatvori tab N" or "close the Nth tab" HIDES that terminal (hide_terminal — tabs are hidden, not killed); "zatvori/ugasi terminal X" by name kills it (close_terminal).
- send_prompt: the user dictates text for an agent that is ALREADY RUNNING ("pošalji prompt …", "reci claude-u da …", "tell claude to …", "send a prompt to terminal X"). Target must be a claude or codex terminal id from the snapshot (default: activeTerminalId); the dictated task goes in "prompt" verbatim, cleaned of filler words. This NEVER creates a terminal — add_terminal does that.
- add_terminal: "kind" defaults to "claude" when an agent is implied or nothing is said; "prompt" is the task the user dictated for the agent, verbatim, cleaned of filler words.
- rename_*: "name" is the new name.
- cycle_tab: "sledeći/sljedeći tab", "prethodni tab", "next/previous tab" → direction "next"|"prev".
- close_tabs: bulk-hide tabs around ONE kept tab. "zatvori ostale tabove" → scope "others"; "zatvori tabove levo/desno" ("to the left/right") → scope "left"|"right". When the user names the terminal to KEEP ("zatvori sve osim klode"), put its id in terminalId; otherwise omit terminalId (the active tab is kept).
- add_feature: creates a new feature; "name" is the spoken feature name, "groupId" is the named project's id (omit groupId when no project is named — the active one is used).
- archive_feature: "arhiviraj <feature>" moves the feature to its project's archive; featureId defaults to the active feature.
- review_accept / review_more_rounds / review_stop control the running review loop of a feature ("prihvati review", "još rundi", "zaustavi/prekini review"); featureId defaults to the active feature.
- If the utterance is not one of these commands, or you are genuinely unsure which target is meant, use action "unknown" or set confidence "low".

Examples:
"prebaci na fajl pejns" → {"action":"switch_feature","featureId":"<id of file-panes>","confidence":"high"}
"otvori grid" → {"action":"toggle_grid","confidence":"high"}
"dodaj klod terminal u file panes sa promptom sredi testove" → {"action":"add_terminal","featureId":"<id>","kind":"claude","prompt":"sredi testove","confidence":"high"}
"close the second tab" → {"action":"hide_terminal","terminalId":"<id of 2nd visible terminal>","confidence":"high"}
"preimenuj feature u export import" → {"action":"rename_feature","featureId":"<active feature id>","name":"export import","confidence":"high"}
"change the grid style to columns" → {"action":"set_grid_style","gridStyle":"cols","confidence":"high"}
"pošalji prompt sredi failing testove" → {"action":"send_prompt","terminalId":"<active terminal id>","prompt":"sredi failing testove","confidence":"high"}
"tell claude in reviewer to summarize the diff" → {"action":"send_prompt","terminalId":"<id of terminal reviewer>","prompt":"summarize the diff","confidence":"high"}
"sledeći tab" → {"action":"cycle_tab","direction":"next","confidence":"high"}
"zatvori ostale tabove" → {"action":"close_tabs","scope":"others","confidence":"high"}
"zatvori sve tabove osim kloda" → {"action":"close_tabs","terminalId":"<id of terminal claude>","confidence":"high"}
"napravi novi feature search u mapitu" → {"action":"add_feature","groupId":"<id of mappit>","name":"search","confidence":"high"}
"arhiviraj file panes" → {"action":"archive_feature","featureId":"<id of file-panes>","confidence":"high"}
"prihvati review" → {"action":"review_accept","confidence":"high"}
"daj još rundi review-a" → {"action":"review_more_rounds","confidence":"high"}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: transcript }
  ]
}

export function parseIntentResponse(content: string): VoiceCommand {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return validateVoiceCommand(JSON.parse(stripped)) } catch { return { action: 'unknown', confidence: 'low' } }
}

export async function parseIntent(opts: {
  transcript: string
  snapshot: WorkspaceSnapshot
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<VoiceCommand> {
  const { transcript, snapshot, apiKey, model, fetchImpl = fetch, timeoutMs = 10000 } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: buildIntentMessages(transcript, snapshot),
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      if (res.status === 429) throw new VoiceIntentError('rate-limit', 'Groq rate limit hit — try again in a minute')
      if (res.status === 401 || res.status === 403) throw new VoiceIntentError('auth', 'Groq API key rejected')
      throw new VoiceIntentError('network', `Groq error: HTTP ${res.status}`)
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] }
    return parseIntentResponse(data.choices?.[0]?.message?.content ?? '')
  } catch (err) {
    if (err instanceof VoiceIntentError) throw err
    if ((err as Error).name === 'AbortError') throw new VoiceIntentError('timeout', 'Groq request timed out')
    throw new VoiceIntentError('network', `Groq request failed: ${String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}

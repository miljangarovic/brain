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
{"action": "switch_feature|toggle_grid|switch_tab|set_grid_style|hide_terminal|add_terminal|close_terminal|rename_feature|rename_terminal|unknown",
 "featureId"?: string, "terminalId"?: string, "kind"?: "shell|claude|codex",
 "prompt"?: string, "name"?: string,
 "gridStyle"?: "auto|auto-left|auto-top|auto-bottom|rows|cols",
 "confidence": "high|low"}

Rules:
- Resolve spoken names fuzzily against the snapshot names (they may be mangled by speech-to-text, e.g. "fajl pejns" = "file-panes") and answer with the matching IDS from the snapshot, never names.
- When no feature/terminal is named, use activeFeatureId / activeTerminalId.
- Ordinal tab references ("drugi tab", "third tab") count only terminals WITHOUT "hidden": true, in snapshot order, within the active feature. The app may also show open file panes as tabs AFTER the terminals — those are not in the snapshot and cannot be voice targets; if an ordinal exceeds the visible terminal count, use action "unknown".
- "close/zatvori tab N" or "close the Nth tab" HIDES that terminal (hide_terminal — tabs are hidden, not killed); "zatvori/ugasi terminal X" by name kills it (close_terminal).
- add_terminal: "kind" defaults to "claude" when an agent is implied or nothing is said; "prompt" is the task the user dictated for the agent, verbatim, cleaned of filler words.
- rename_*: "name" is the new name.
- If the utterance is not one of these commands, or you are genuinely unsure which target is meant, use action "unknown" or set confidence "low".

Examples:
"prebaci na fajl pejns" → {"action":"switch_feature","featureId":"<id of file-panes>","confidence":"high"}
"otvori grid" → {"action":"toggle_grid","confidence":"high"}
"dodaj klod terminal u file panes sa promptom sredi testove" → {"action":"add_terminal","featureId":"<id>","kind":"claude","prompt":"sredi testove","confidence":"high"}
"close the second tab" → {"action":"hide_terminal","terminalId":"<id of 2nd visible terminal>","confidence":"high"}
"preimenuj feature u export import" → {"action":"rename_feature","featureId":"<active feature id>","name":"export import","confidence":"high"}
"change the grid style to columns" → {"action":"set_grid_style","gridStyle":"cols","confidence":"high"}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: transcript }
  ]
}

// Whisper biasing prompt: latinica (nudges the output script) + command verbs
// + the workspace names the user is likely to say. Whisper caps the initial
// prompt at 224 tokens — names are joined until a ~600-char budget runs out.
export function whisperInitialPrompt(snapshot: WorkspaceSnapshot): string {
  const names: string[] = []
  for (const g of snapshot.groups) {
    names.push(g.name)
    for (const f of g.features) names.push(f.name)
  }
  let list = ''
  for (const n of names) {
    if (list.length + n.length > 600) break
    list += (list ? ', ' : '') + n
  }
  return `Komande: prebaci na, otvori grid, zatvori grid, dodaj claude terminal, dodaj codex terminal, zatvori terminal, sakrij terminal, preimenuj, sa promptom. Imena: ${list}.`
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

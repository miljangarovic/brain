# Voice Command: Send Prompt to a Running Agent — Design

**Date:** 2026-06-11
**Status:** Approved
**Extends:** `2026-06-10-voice-commands-design.md` (v1 explicitly deferred this)

## Goal

A tenth voice action, `send_prompt`: speak a prompt into an ALREADY-RUNNING
claude/codex terminal ("pošalji prompt sredi testove", "reci claude-u da
doda testove u terminal reviewer"). The text is injected into the agent's PTY
as if typed — no `claude -p`, no new session — and submitted automatically
after the confirm overlay.

## Scope

- Targets: **agent terminals only** (claude/codex) whose agent process is
  currently LIVE. Shell terminals and cold/dead agent terminals are out —
  for a cold terminal the existing `add_terminal`-with-prompt command is the
  alternative, and the error message says so.
- Auto-submit: after the user confirms (Enter in the overlay, prompt
  editable), the text is injected AND submitted. No type-only mode.
- Out of scope: spawning a cold terminal then sending, waiting for the
  agent's answer, multi-turn flows.

## Decisions

- **Injection over headless:** reuses the existing `pty:input` path
  (`window.brain.writePty(id, data, user)`) — the prompt lands in the live
  session's context, visible in the terminal, no extra Claude session or
  API surface. (User-mandated: no `claude -p`.)
- **Liveness gate at plan time:** App already tracks
  `liveAgents: Record<terminalId, AgentKind | undefined>` from `pty:proc`
  events (`detectAgent`). `planCommand` gains a context parameter carrying
  it, so a dead/cold target produces the error BEFORE any overlay.
- **Always confirm:** sending free-form text to a working agent is the
  highest-blast-radius voice action; it gets the confirm overlay with the
  editable prompt textarea, same as `add_terminal`.

## Changes by module

| Module | Change |
|---|---|
| `src/shared/voice.ts` | `'send_prompt'` added to `VOICE_ACTIONS` (fields reuse `terminalId?` + `prompt`); validator untouched otherwise |
| `src/main/voice/intent.ts` | system prompt: action list +`send_prompt`, one rule line (target must be a claude/codex terminal from the snapshot, default = active terminal; the dictated text goes in "prompt") and two examples (sr + en) |
| `src/renderer/src/voice/executor.ts` | `planCommand(cmd, s, ctx)` — NEW third param `ctx: { liveAgents: Record<string, AgentKind \| undefined> }`, REQUIRED (an optional param would let stale call sites silently skip the liveness gate). `send_prompt` case: terminal = `terminalId ?? activeTerminalId`; must exist, `kind` ∈ {claude, codex}, `ctx.liveAgents[id]` truthy — else error ("Agent is not running — say 'add a claude terminal with prompt …' instead" / target-specific message). Valid → confirm plan `{ summary: `Send to "${name}"`, editablePrompt: prompt, descriptor: { type: 'sendPrompt', terminalId, prompt } }`. `prompt` required (missing → error). |
| `src/renderer/src/voice/run.ts` | new descriptor case: `sendPrompt` → `deps.sendPrompt(terminalId, prompt)` (no `apply`); `RunDeps` gains `sendPrompt(terminalId: string, prompt: string): void` |
| `src/renderer/src/voice/useVoice.ts` | passes `ctx` into `planCommand`; `VoiceDeps` gains `liveAgents` + `sendPrompt`; confirm-toast mapping gains `sendPrompt → 'Prompt sent'` |
| `src/renderer/src/voice/inject.ts` (NEW) | pure helper `promptWrites(prompt: string): string[]` — returns the write sequence: single-line → `[prompt, '\r']`; contains `\n` → `['\x1b[200~' + prompt + '\x1b[201~', '\r']` (bracketed paste so newlines don't submit early) |
| `src/renderer/src/App.tsx` | implements `sendPrompt(id, prompt)`: `apply((s) => showTerminal(s, id))` (activate so the user sees the response), then writes `promptWrites(prompt)` via `window.brain.writePty(id, chunk, true)` — the trailing `'\r'` write delayed ~50 ms (TUIs need a beat to process the paste before submit); wires `liveAgents` + `sendPrompt` into `useVoice` |

Busy agent: claude/codex CLIs queue typed input while responding — inject
normally, no special handling.

## Error handling

- No target resolvable / terminal not found → error toast with transcript.
- Target is a shell terminal → error: "Voice prompts can only go to claude/codex terminals".
- Target agent not live (cold or exited) → error: "Agent is not running in
  \"<name>\" — say 'add a claude terminal with prompt …' to start one".
- Missing prompt → error ("No prompt understood").
- Low confidence → confirm overlay regardless (inherited behavior).

## Testing

- `executor.test.ts`: live agent → confirm with editablePrompt + sendPrompt
  descriptor; cold agent → error; shell target → error; missing prompt →
  error; default-to-active-terminal resolution. (Existing planCommand call
  sites in tests gain the ctx argument — a `ctx()` fixture helper.)
- `run.test.ts`: sendPrompt descriptor calls `deps.sendPrompt`, never `apply`.
- `inject.test.ts`: single-line vs multiline write sequences.
- `intent.test.ts`: prompt builder mentions send_prompt.
- Manual: speak a prompt to a running claude; busy claude (queues); multiline
  edited prompt; cold-terminal error message.

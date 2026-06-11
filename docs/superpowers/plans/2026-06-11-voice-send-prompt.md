# Voice send_prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenth voice action, `send_prompt`, that injects a spoken prompt into an already-running claude/codex terminal via the existing PTY input path and auto-submits after the confirm overlay.

**Architecture:** Pure additions to the existing voice pipeline — a new `VOICE_ACTIONS` entry, two intent-prompt examples, a `send_prompt` confirm case in the executor (gated on App's `liveAgents` map, passed in as a new REQUIRED `PlanContext` parameter), a `sendPrompt` delegate descriptor in `run.ts`, and an App-level injector that writes `promptWrites(prompt)` through `window.brain.writePty` (text first, `'\r'` 50 ms later). No new IPC channels; no main-process changes.

**Tech Stack:** Existing voice modules (TypeScript, vitest); `pty:input` IPC (`BrainApi.writePty`).

**Spec:** `docs/superpowers/specs/2026-06-11-voice-send-prompt-design.md`

**File map:**
- Modify: `src/shared/voice.ts` (+1 action), `src/shared/voice.test.ts` (+1 test)
- Modify: `src/main/voice/intent.ts` (prompt: action list, rule, 2 examples), `src/main/voice/intent.test.ts` (+1 assertion)
- Create: `src/renderer/src/voice/inject.ts` + `inject.test.ts` (pure write-sequence helper)
- Modify: `src/renderer/src/voice/executor.ts` (PlanContext + case), `executor.test.ts` (ctx at all call sites, +5 tests)
- Modify: `src/renderer/src/voice/run.ts` (+descriptor), `run.test.ts` (+1 test)
- Modify: `src/renderer/src/voice/useVoice.ts` (deps, ctx, confirm branch), `src/renderer/src/App.tsx` (injector + wiring)

---

### Task 1: Shared action + intent prompt

**Files:**
- Modify: `src/shared/voice.ts`, `src/shared/voice.test.ts`
- Modify: `src/main/voice/intent.ts`, `src/main/voice/intent.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/shared/voice.test.ts`, add inside `describe('validateVoiceCommand', ...)`:

```ts
  it('passes send_prompt through', () => {
    expect(validateVoiceCommand({ action: 'send_prompt', terminalId: 't1', prompt: 'sredi testove', confidence: 'high' }))
      .toEqual({ action: 'send_prompt', terminalId: 't1', prompt: 'sredi testove', confidence: 'high' })
  })
```

In `src/main/voice/intent.test.ts`, inside the test `'embeds snapshot ids/names, active ids, hidden flags and the transcript'`, add after the `expect(system.content).toContain('switch_feature')` line:

```ts
    expect(system.content).toContain('send_prompt')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/voice.test.ts src/main/voice/intent.test.ts`
Expected: the new send_prompt passthrough test FAILS (action falls to unknown); the intent assertion FAILS (prompt has no send_prompt).

- [ ] **Step 3: Implement**

In `src/shared/voice.ts`, add `'send_prompt'` to `VOICE_ACTIONS` before `'unknown'`:

```ts
export const VOICE_ACTIONS = [
  'switch_feature', 'toggle_grid', 'switch_tab', 'set_grid_style',
  'hide_terminal', 'add_terminal', 'close_terminal',
  'rename_feature', 'rename_terminal', 'send_prompt', 'unknown'
] as const
```

In `src/main/voice/intent.ts`, three edits to the system prompt inside `buildIntentMessages`:

1. The action enum line gains `send_prompt|` before `unknown`:

```
{"action": "switch_feature|toggle_grid|switch_tab|set_grid_style|hide_terminal|add_terminal|close_terminal|rename_feature|rename_terminal|send_prompt|unknown",
```

2. In the Rules section, add this rule directly after the hide-vs-close rule line:

```
- send_prompt: the user dictates text for an agent that is ALREADY RUNNING ("pošalji prompt …", "reci claude-u da …", "tell claude to …", "send a prompt to terminal X"). Target must be a claude or codex terminal id from the snapshot (default: activeTerminalId); the dictated task goes in "prompt" verbatim, cleaned of filler words. This NEVER creates a terminal — add_terminal does that.
```

3. Add two examples before the closing backtick of the template literal:

```
"pošalji prompt sredi failing testove" → {"action":"send_prompt","terminalId":"<active terminal id>","prompt":"sredi failing testove","confidence":"high"}
"tell claude in reviewer to summarize the diff" → {"action":"send_prompt","terminalId":"<id of terminal reviewer>","prompt":"summarize the diff","confidence":"high"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/voice.test.ts src/main/voice/intent.test.ts`
Expected: PASS (9 shared + 8 intent).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/shared/voice.ts src/shared/voice.test.ts src/main/voice/intent.ts src/main/voice/intent.test.ts
git commit -m "feat(voice): send_prompt action in schema and intent prompt"
```

---

### Task 2: Injection write-sequence helper

**Files:**
- Create: `src/renderer/src/voice/inject.ts`
- Create: `src/renderer/src/voice/inject.test.ts`

- [ ] **Step 1: Write the failing test** — `src/renderer/src/voice/inject.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { promptWrites } from './inject'

describe('promptWrites', () => {
  it('single-line: text then a separate carriage return', () => {
    expect(promptWrites('sredi testove')).toEqual(['sredi testove', '\r'])
  })
  it('multiline rides in a bracketed-paste envelope', () => {
    expect(promptWrites('line1\nline2')).toEqual(['\x1b[200~line1\nline2\x1b[201~', '\r'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/voice/inject.test.ts`
Expected: FAIL — `Cannot find module './inject'`

- [ ] **Step 3: Implement** — `src/renderer/src/voice/inject.ts`:

```ts
// Write sequence for injecting a prompt into a live agent's PTY. Multiline
// text rides in a bracketed-paste envelope so embedded newlines don't submit
// early; the submit ('\r') is a SEPARATE write — the caller delays it a beat
// so the TUI processes the paste before the Enter.
export function promptWrites(prompt: string): [text: string, submit: string] {
  const text = prompt.includes('\n') ? `\x1b[200~${prompt}\x1b[201~` : prompt
  return [text, '\r']
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/voice/inject.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/inject.ts src/renderer/src/voice/inject.test.ts
git commit -m "feat(voice): prompt injection write-sequence helper"
```

---

### Task 3: Executor case, delegate descriptor, hook + App wiring

One commit: the `PlanContext` signature change ripples through executor → useVoice → App, and `VoiceDeps` gains required fields — typecheck only passes with all four wired together. TDD the pure parts first (vitest does not typecheck, so tests run green mid-task).

**Files:**
- Modify: `src/renderer/src/voice/executor.ts`, `src/renderer/src/voice/executor.test.ts`
- Modify: `src/renderer/src/voice/run.ts`, `src/renderer/src/voice/run.test.ts`
- Modify: `src/renderer/src/voice/useVoice.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing executor tests**

In `src/renderer/src/voice/executor.test.ts`:

1. Extend the store import with `setActiveTerminal` and add an `AgentKind` type import:

```ts
import {
  createInitialState, addGroup, addFeature, addTerminal, hideTerminal,
  toggleFeatureViewMode, setActiveTerminal
} from '../store'
import type { AgentKind } from '../agents'
```

2. Add a ctx fixture helper next to the existing `cmd` helper:

```ts
const ctx = (liveAgents: Record<string, AgentKind | undefined> = {}) => ({ liveAgents })
```

3. Update EVERY existing `planCommand(...)` call in the file from `planCommand(cmd({...}), s)` to `planCommand(cmd({...}), s, ctx())` — none of the existing tests involve live agents, so the empty context is correct for all of them.

4. Add a new describe block at the end of the file:

```ts
describe('planCommand — send_prompt', () => {
  it('live claude target → confirm with editable prompt and sendPrompt descriptor', () => {
    const { s, t1 } = fixture()
    const p = planCommand(cmd({ action: 'send_prompt', terminalId: t1, prompt: 'sredi testove' }), s, ctx({ [t1]: 'claude' }))
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    expect(p.editablePrompt).toBe('sredi testove')
    expect(p.summary).toContain('claude')
    expect(p.descriptor).toEqual({ type: 'sendPrompt', terminalId: t1, prompt: 'sredi testove' })
  })
  it('cold (not running) agent → error pointing at add_terminal', () => {
    const { s, t1 } = fixture()
    const p = planCommand(cmd({ action: 'send_prompt', terminalId: t1, prompt: 'x' }), s, ctx())
    if (p.type !== 'error') throw new Error('expected error')
    expect(p.message).toMatch(/not running/)
  })
  it('shell target → error', () => {
    const { s, t2 } = fixture()
    const p = planCommand(cmd({ action: 'send_prompt', terminalId: t2, prompt: 'x' }), s, ctx())
    if (p.type !== 'error') throw new Error('expected error')
    expect(p.message).toMatch(/claude\/codex/)
  })
  it('missing prompt → error', () => {
    const { s, t1 } = fixture()
    expect(planCommand(cmd({ action: 'send_prompt', terminalId: t1 }), s, ctx({ [t1]: 'claude' })).type).toBe('error')
  })
  it('defaults to the active terminal', () => {
    let { s, t1 } = fixture()
    s = setActiveTerminal(s, t1)
    const p = planCommand(cmd({ action: 'send_prompt', prompt: 'nastavi' }), s, ctx({ [t1]: 'claude' }))
    if (p.type !== 'confirm') throw new Error('expected confirm')
    if (p.descriptor.type !== 'sendPrompt') throw new Error('expected sendPrompt descriptor')
    expect(p.descriptor.terminalId).toBe(t1)
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: the 5 new tests FAIL — the current `planHigh` switch has no `send_prompt` case, so it returns `undefined` and the assertions throw (vitest does not typecheck, so the extra `ctx` argument is simply ignored at runtime). Existing 15 still pass.

- [ ] **Step 3: Implement the executor case**

In `src/renderer/src/voice/executor.ts`:

1. Add the import and context type:

```ts
import type { AgentKind } from '../agents'
```

```ts
// Live-process context the executor cannot derive from AppState: which
// terminals currently host a RUNNING agent (App tracks this from pty:proc
// events). REQUIRED parameter — an optional one would let stale call sites
// silently skip the liveness gate.
export interface PlanContext { liveAgents: Record<string, AgentKind | undefined> }
```

2. Extend the descriptor union:

```ts
export type ExecDescriptor =
  | StateDescriptor
  | { type: 'closeTerminal'; terminalId: string }
  | { type: 'addTerminal'; featureId: string; kind: TerminalKind; name?: string; prompt?: string }
  | { type: 'sendPrompt'; terminalId: string; prompt: string }
```

3. Thread the context through both functions (bodies unchanged except the call):

```ts
export function planCommand(cmd: VoiceCommand, s: AppState, ctx: PlanContext): ExecPlan {
  const plan = planHigh(cmd, s, ctx)
  // Low LLM confidence: never run silently — show what was understood first.
  if (cmd.confidence === 'low' && plan.type === 'run') {
    return { type: 'confirm', summary: plan.descriptor.toast, descriptor: plan.descriptor }
  }
  return plan
}

function planHigh(cmd: VoiceCommand, s: AppState, ctx: PlanContext): ExecPlan {
```

4. Add the case before `case 'unknown':`

```ts
    case 'send_prompt': {
      const id = cmd.terminalId ?? s.activeTerminalId
      const t = id ? getTerminalById(s, id) : null
      if (!t) return err('Terminal not found — try again')
      if (t.kind !== 'claude' && t.kind !== 'codex') {
        return err('Voice prompts can only go to claude/codex terminals')
      }
      if (!ctx.liveAgents[t.id]) {
        return err(`Agent is not running in "${t.name}" — say "add a claude terminal with prompt …" to start one`)
      }
      if (!cmd.prompt) return err('No prompt understood')
      const prompt = cmd.prompt
      return {
        type: 'confirm',
        summary: `Send to "${t.name}"`,
        editablePrompt: prompt,
        descriptor: { type: 'sendPrompt', terminalId: t.id, prompt }
      }
    }
```

- [ ] **Step 4: Run executor tests**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Write the failing run.ts test**

In `src/renderer/src/voice/run.test.ts`: add `sendPrompt: vi.fn()` to the `deps(s)` helper object, and add this test to the describe block:

```ts
  it('sendPrompt descriptor delegates to deps.sendPrompt only', () => {
    const { s } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'sendPrompt', terminalId: 'tx', prompt: 'sredi testove' }, d)
    expect(d.sendPrompt).toHaveBeenCalledWith('tx', 'sredi testove')
    expect(d.apply).not.toHaveBeenCalled()
    expect(d.launchAgent).not.toHaveBeenCalled()
  })
```

Run: `npx vitest run src/renderer/src/voice/run.test.ts`
Expected: the new test FAILS (descriptor falls through to addTerminal handling or throws).

- [ ] **Step 6: Implement run.ts**

In `src/renderer/src/voice/run.ts`:

1. `RunDeps` gains:

```ts
  // Injects a prompt into a live agent terminal's PTY (App implements it via
  // writePty — see promptWrites for the write sequence).
  sendPrompt: (terminalId: string, prompt: string) => void
```

2. In `runDescriptor`, add before the addTerminal handling:

```ts
  if (d.type === 'sendPrompt') {
    deps.sendPrompt(d.terminalId, d.prompt)
    return
  }
```

Run: `npx vitest run src/renderer/src/voice/run.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Wire useVoice**

In `src/renderer/src/voice/useVoice.ts`:

1. `VoiceDeps` gains two required members:

```ts
export interface VoiceDeps {
  state: AppState
  apply: (fn: (s: AppState) => AppState) => void
  markStarted: (id: string) => void
  stopReviewLoop: (terminalId: string) => void
  launchAgent: (featureId: string, kind: AgentKind, opts?: { prompt?: string; name?: string }) => void
  liveAgents: Record<string, AgentKind | undefined>
  sendPrompt: (terminalId: string, prompt: string) => void
}
```

2. The `planCommand` call in the `onVoiceResult` effect gains the context:

```ts
    const plan = planCommand(command, depsRef.current.state, { liveAgents: depsRef.current.liveAgents })
```

3. `confirm()` gains a sendPrompt branch and toast; full updated callback:

```ts
  const confirm = useCallback((editedPrompt?: string) => {
    const s = uiRef.current
    if (s.kind !== 'confirm') return
    let d = s.descriptor
    if (d.type === 'addTerminal' && editedPrompt !== undefined) {
      const { prompt: _replaced, ...rest } = d
      d = editedPrompt.trim() ? { ...rest, prompt: editedPrompt } : rest
    }
    if (d.type === 'sendPrompt' && editedPrompt !== undefined) {
      const p = editedPrompt.trim()
      // An emptied prompt means there is nothing to send — treat as cancel.
      if (!p) { dispatch({ type: 'dismiss' }); return }
      d = { ...d, prompt: p }
    }
    runDescriptor(d, runDeps())
    const toast = d.type === 'state' ? d.toast
      : d.type === 'closeTerminal' ? 'Terminal closed'
      : d.type === 'sendPrompt' ? 'Prompt sent'
      : 'Terminal launched'
    dispatch({ type: 'executed', toast })
  }, [])
```

(`runDeps()` spreads `depsRef.current`, which now carries `sendPrompt` — `RunDeps` is satisfied structurally; the extra `liveAgents` key is harmless.)

- [ ] **Step 8: Wire App.tsx**

In `src/renderer/src/App.tsx`:

1. Add the import:

```ts
import { promptWrites } from './voice/inject'
```

2. Add the injector right above the existing `const voice = useVoice({...})`:

```ts
  const sendPromptToAgent = (terminalId: string, prompt: string) => {
    // Surface the target so the user watches the agent take the prompt.
    apply((s) => showTerminal(s, terminalId))
    const [text, submit] = promptWrites(prompt)
    window.brain.writePty(terminalId, text, true)
    // Submit separately after a beat — the TUI needs to process the paste
    // before the Enter, or it can swallow the newline into the input.
    setTimeout(() => window.brain.writePty(terminalId, submit, true), 50)
  }
```

3. Extend the `useVoice` call:

```ts
  const voice = useVoice({
    state, apply, markStarted,
    stopReviewLoop: (id) => review.stopLoop(id),
    launchAgent,
    liveAgents,
    sendPrompt: sendPromptToAgent
  })
```

(`liveAgents` and `showTerminal` are already in scope in App.tsx.)

- [ ] **Step 9: Full verification**

```bash
npm run typecheck
npm test
```

Expected: typecheck clean; full suite passes (~660 tests — 651 + the 9 added across Tasks 1-3).

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/voice/executor.ts src/renderer/src/voice/executor.test.ts src/renderer/src/voice/run.ts src/renderer/src/voice/run.test.ts src/renderer/src/voice/useVoice.ts src/renderer/src/App.tsx
git commit -m "feat(voice): send_prompt — inject spoken prompt into a running agent"
```

---

## Final verification (manual, with the app running)

- [ ] `npm run dev`; open a claude terminal and let it boot.
- [ ] "pošalji prompt koliko je fajlova u src" → confirm modal with the editable prompt → Enter → the text lands in the claude session and submits; toast "Prompt sent"; the target terminal is activated.
- [ ] Edit the prompt in the textarea before Enter → the EDITED text is what arrives.
- [ ] Empty the textarea → Enter → nothing is sent (overlay closes).
- [ ] Multiline prompt (add a newline in the textarea) → arrives as one message, not submitted early.
- [ ] Target a COLD claude terminal (created but never opened, or exited) → error toast "Agent is not running in …".
- [ ] "pošalji prompt …" while a shell tab is active → error about claude/codex targets.
- [ ] Send while the agent is mid-response → the prompt queues in the CLI input (no corruption).
- [ ] English phrasing: "tell claude to run the tests".

# Voice Actions Batch 2 (review control, tab cycling/bulk close, feature lifecycle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven new voice actions — `review_accept`, `review_more_rounds`, `review_stop`, `cycle_tab`, `close_tabs`, `add_feature`, `archive_feature` — wired through the existing voice pipeline (shared contract → intent prompt → executor → run → App).

**Intent:** User-selected batch (conversation request, 2026-06-11) of three capabilities from the voice-expansion survey: (1) hands-free review-loop control (accept / more rounds / stop), (2) tab cycling + bulk tab close, (3) feature create/archive by voice. The seven actions in Goal map 1:1 onto that request; `send_prompt` (the 4th surveyed capability) is a separate in-flight plan.

**Architecture:** Pure additions to the established voice flow. Review control gets a new `ReviewDescriptor` delegate (run.ts routes it to `useReview`'s `acceptPhase`/`moreRounds`/`stopLoop` via new `RunDeps`); the executor gains a required `PlanContext` parameter carrying App's `reviewStatus` map (to gate `review_more_rounds` on `needs-decision`). Tab cycling extracts App.tsx's inline `cycleTab` logic into pure store selectors (`visiblePanes`/`cyclePane`) reused by both the keyboard shortcut and the executor. `close_tabs`, `add_feature`, `archive_feature` are pure state descriptors over existing store reducers (`hideTerminal`/`closeFile`, `addFeature`, `archiveFeature`). No new IPC channels; no main-process changes beyond the intent prompt.

**Tech Stack:** Existing voice modules (TypeScript, vitest). Files: `src/shared/voice.ts`, `src/main/voice/intent.ts`, `src/renderer/src/store.ts`, `src/renderer/src/voice/{executor,run,useVoice}.ts`, `src/renderer/src/App.tsx`.

**Plan/confirm policy** (mirrors the existing convention — confirm for create/destroy, run for navigation):

| Action | Plan type | Why |
|---|---|---|
| `review_accept` | run, gated on `needs-decision` status | hands-free decision is the point, but mid-review accept would tear down the reviewer and discard the in-flight critique — the GUI offers Accept only at needs-decision (`FeatureHeader`), and voice must not exceed that affordance unconfirmed |
| `review_more_rounds` | run, gated on `needs-decision` status | mid-review it would inject a stray prompt into the reviewer PTY |
| `review_stop` | confirm | kills the reviewer terminal and the loop; always available (matches the GUI) |
| `cycle_tab` | run | pure navigation |
| `close_tabs` | run | terminals are only hidden (shells keep running); file panes auto-save |
| `add_feature` | confirm | creates something |
| `archive_feature` | confirm | its terminals' PTYs get killed by the reaper |

**Coordination with `2026-06-11-voice-send-prompt.md` (in flight in another session):** Both plans append to `VOICE_ACTIONS`, the intent prompt, the executor switch, `run.ts`, `useVoice`, and App wiring — and BOTH introduce a required third `planCommand` parameter named `PlanContext`. They compose: send_prompt's context field is `liveAgents`, this plan's is `reviewStatus`. Whichever lands second: (1) MERGE the two `PlanContext` interfaces into one `{ liveAgents, reviewStatus }`, (2) update the executor.test `ctx` helper to supply both fields, (3) in `useVoice`, pass both fields at the single `planCommand` call site, (4) keep both actions in `VOICE_ACTIONS`/intent prompt (insert order before `'unknown'` doesn't matter). Check `git log`/`src/shared/voice.ts` for `send_prompt` before starting Task 1.

**File map:**
- Modify: `src/shared/voice.ts` (+7 actions, +3 fields), `src/shared/voice.test.ts` (+2 tests)
- Modify: `src/renderer/src/store.ts` (+`visiblePanes`, `cyclePane`), `src/renderer/src/store.test.ts` (+4 tests)
- Modify: `src/renderer/src/App.tsx` (cycleTab refactor; voice deps wiring)
- Modify: `src/renderer/src/voice/executor.ts` (`PlanContext`, `ReviewDescriptor`, 7 cases), `executor.test.ts` (ctx at all call sites, narrowing, +12 tests)
- Modify: `src/renderer/src/voice/run.ts` (+2 deps, review branch), `run.test.ts` (+1 test, deps helper)
- Modify: `src/renderer/src/voice/useVoice.ts` (deps, planCommand ctx, confirm toast)
- Modify: `src/main/voice/intent.ts` (prompt: actions, fields, rules, examples), `intent.test.ts` (+1 test)
- Modify: `README.md` (one feature line)

**Branch:** create `feature/voice-actions-2` off `develop` before Task 1 (`git checkout -b feature/voice-actions-2 develop`). Integration at the end via superpowers:finishing-a-development-branch.

---

### Task 1: Shared contract — new actions and fields

**Files:**
- Modify: `src/shared/voice.ts`
- Test: `src/shared/voice.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/shared/voice.test.ts`, add inside `describe('validateVoiceCommand', ...)`:

```ts
  it('passes the batch-2 actions through with their fields', () => {
    expect(validateVoiceCommand({ action: 'cycle_tab', direction: 'prev', confidence: 'high' }))
      .toEqual({ action: 'cycle_tab', direction: 'prev', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'close_tabs', scope: 'left', terminalId: 't1', confidence: 'high' }))
      .toEqual({ action: 'close_tabs', scope: 'left', terminalId: 't1', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'add_feature', groupId: 'g1', name: 'search', confidence: 'high' }))
      .toEqual({ action: 'add_feature', groupId: 'g1', name: 'search', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'archive_feature', featureId: 'f1', confidence: 'high' }))
      .toEqual({ action: 'archive_feature', featureId: 'f1', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'review_accept', confidence: 'high' }))
      .toEqual({ action: 'review_accept', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'review_more_rounds', confidence: 'high' }))
      .toEqual({ action: 'review_more_rounds', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'review_stop', confidence: 'high' }))
      .toEqual({ action: 'review_stop', confidence: 'high' })
  })
  it('strips invalid direction and scope', () => {
    expect(validateVoiceCommand({ action: 'close_tabs', scope: 'middle', direction: 'sideways', confidence: 'high' }))
      .toEqual({ action: 'close_tabs', confidence: 'high' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/voice.test.ts`
Expected: the two new tests FAIL (unknown actions collapse to `{ action: 'unknown', confidence: 'low' }`). The 8 existing tests pass.

- [ ] **Step 3: Implement the contract**

In `src/shared/voice.ts`:

Replace the `VOICE_ACTIONS` array (keep any `'send_prompt'` entry if it is already there):

```ts
export const VOICE_ACTIONS = [
  'switch_feature', 'toggle_grid', 'switch_tab', 'set_grid_style',
  'hide_terminal', 'add_terminal', 'close_terminal',
  'rename_feature', 'rename_terminal',
  'cycle_tab', 'close_tabs', 'add_feature', 'archive_feature',
  'review_accept', 'review_more_rounds', 'review_stop',
  'unknown'
] as const
```

Below the `KINDS` const, add:

```ts
export type CycleDirection = 'next' | 'prev'
export type CloseScope = 'others' | 'left' | 'right'
const DIRECTIONS: CycleDirection[] = ['next', 'prev']
const SCOPES: CloseScope[] = ['others', 'left', 'right']
```

Extend `VoiceCommand` (new fields after `terminalId`):

```ts
export interface VoiceCommand {
  action: VoiceAction
  featureId?: string
  terminalId?: string
  groupId?: string
  kind?: TerminalKind
  prompt?: string
  name?: string
  gridStyle?: GridStyle
  direction?: CycleDirection
  scope?: CloseScope
  confidence: 'high' | 'low'
}
```

In `validateVoiceCommand`, after the `terminalId` line add:

```ts
  const groupId = str(o.groupId); if (groupId) cmd.groupId = groupId
```

and after the `gridStyle` line add:

```ts
  if (DIRECTIONS.includes(o.direction as CycleDirection)) cmd.direction = o.direction as CycleDirection
  if (SCOPES.includes(o.scope as CloseScope)) cmd.scope = o.scope as CloseScope
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/voice.test.ts`
Expected: all PASS.

- [ ] **Step 5: Keep the executor switch exhaustive (temporary stub)**

`tsconfig` has `strict: true`, so widening `VoiceAction` makes `planHigh`'s switch non-exhaustive and `tsc` fails with TS2366 (function lacks ending return). Add a temporary grouped stub to the switch in `src/renderer/src/voice/executor.ts`, right before `case 'unknown'` — Tasks 3, 5 and 6 replace these labels with the real implementations:

```ts
    // Batch-2 actions land in follow-up commits; the stub keeps the switch exhaustive.
    case 'cycle_tab': case 'close_tabs': case 'add_feature': case 'archive_feature':
    case 'review_accept': case 'review_more_rounds': case 'review_stop':
      return err('Not supported yet')
```

- [ ] **Step 6: Verify typecheck stays clean**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/voice.ts src/shared/voice.test.ts src/renderer/src/voice/executor.ts
git commit -m "feat(voice): batch-2 actions and fields in the shared contract"
```

---

### Task 2: Store selectors `visiblePanes` / `cyclePane` + App.tsx cycleTab refactor

**Files:**
- Modify: `src/renderer/src/store.ts` (add to the selectors section, after `terminalPath`)
- Modify: `src/renderer/src/App.tsx:278-289` (the inline `cycleTab` in the keydown effect)
- Test: `src/renderer/src/store.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/store.test.ts`, extend the `./store` import with `visiblePanes`, `cyclePane`, and (if not already imported) `openFile`, `hideTerminal`, `setActiveTerminal`. Add a new top-level describe:

```ts
describe('visiblePanes / cyclePane', () => {
  function fix() {
    let s = createInitialState()
    s = addGroup(s, 'p', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 't1' })
    s = addTerminal(s, fid, { name: 't2' })
    s = openFile(s, fid, { path: '/p/readme.md' })
    const f = s.workspace.groups[0].features[0]
    return { s, fid, t1: f.terminals[0].id, t2: f.terminals[1].id, p1: f.files![0].id }
  }
  it('lists visible terminals then file panes, skipping hidden', () => {
    let { s, t1, t2, p1 } = fix()
    s = hideTerminal(s, t1)
    expect(visiblePanes(s).map((v) => v.id)).toEqual([t2, p1])
    expect(visiblePanes(s).map((v) => v.file)).toEqual([false, true])
  })
  it('visiblePanes takes an explicit featureId', () => {
    const { s, fid, t1, t2, p1 } = fix()
    expect(visiblePanes(s, fid).map((v) => v.id)).toEqual([t1, t2, p1])
  })
  it('cyclePane wraps forward from the last pane to the first', () => {
    let { s, t1, p1 } = fix()
    s = setActiveTerminal(s, p1)
    expect(cyclePane(s, 1)?.id).toBe(t1)
  })
  it('cyclePane steps backward and is null with no visible panes', () => {
    let { s, t2, p1 } = fix()
    s = setActiveTerminal(s, p1)
    expect(cyclePane(s, -1)?.id).toBe(t2)
    let empty = createInitialState()
    empty = addGroup(empty, 'q', '/q')
    expect(cyclePane(empty, 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: FAIL — `visiblePanes` / `cyclePane` are not exported.

- [ ] **Step 3: Implement the selectors**

In `src/renderer/src/store.ts`, after `terminalPath` add:

```ts
// Visible panes of a feature in tab order: terminals not hidden, then open file
// panes — the exact list the tab bar renders (App.tsx tabItems). Defaults to
// the active feature.
export const visiblePanes = (s: AppState, featureId?: string): { id: string; file: boolean }[] => {
  const f = featureId
    ? s.workspace.groups.flatMap((g) => g.features).find((x) => x.id === featureId) ?? null
    : getActiveFeature(s)
  return [
    ...(f?.terminals.filter((t) => !s.hidden.includes(t.id)).map((t) => ({ id: t.id, file: false })) ?? []),
    ...((f?.files ?? []).map((p) => ({ id: p.id, file: true })))
  ]
}

// The pane `dir` steps away from the active one, wrapping; null when the
// active feature has no visible panes.
export const cyclePane = (s: AppState, dir: 1 | -1): { id: string; file: boolean } | null => {
  const visible = visiblePanes(s)
  if (visible.length === 0) return null
  const idx = visible.findIndex((v) => v.id === s.activeTerminalId)
  return visible[(idx + dir + visible.length) % visible.length]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: all PASS.

- [ ] **Step 5: Refactor App.tsx to use cyclePane**

In `src/renderer/src/App.tsx`, add `cyclePane` to the big `./store` import block. Replace the inline `cycleTab` function inside the keydown effect (currently building the `visible` array itself):

```ts
    const cycleTab = (dir: 1 | -1) => {
      const next = cyclePane(state, dir)
      if (!next) return
      if (!next.file) markStarted(next.id)
      apply((s) => setActiveTerminal(s, next.id))
    }
```

(The `cycleTab(1)` / `cycleTab(-1)` call sites stay as they are.)

- [ ] **Step 6: Verify nothing broke**

Run: `npm run typecheck && npx vitest run src/renderer/src`
Expected: typecheck clean, all renderer tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts src/renderer/src/App.tsx
git commit -m "refactor(store): extract visiblePanes/cyclePane, reuse in App tab cycling"
```

---

### Task 3: Executor — `PlanContext`, `ReviewDescriptor`, review actions

**Files:**
- Modify: `src/renderer/src/voice/executor.ts`
- Test: `src/renderer/src/voice/executor.test.ts`

- [ ] **Step 1: Update existing call sites and write the failing tests**

In `src/renderer/src/voice/executor.test.ts`:

1. Add imports: `setActiveFeature`, `openFile`, `setActiveTerminal` to the `../store` import (used in Tasks 5–6 too); add `import type { ReviewStatus } from '@shared/types'`.
2. Below the `cmd` helper add:

```ts
const ctx = (reviewStatus: Record<string, ReviewStatus | undefined> = {}) => ({ reviewStatus })
```

> If `send_prompt` already landed, `PlanContext` exists with `liveAgents` — make the helper `({ liveAgents: {}, reviewStatus })` and keep its existing tests' ctx calls.

3. Mechanically change every existing `planCommand(<x>, s)` call to `planCommand(<x>, s, ctx())` (17 call sites).
4. In every existing test that narrows `if (p.type !== 'run')` and then touches `p.descriptor.run`/`p.descriptor.startIds`, add a second narrowing line right after (the run-plan descriptor union widens in this task):

```ts
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
```

(6 sites: both `switch_feature` tests, the first `toggle_grid` test, `switch_tab`, `set_grid_style`, `hide_terminal`. The second `toggle_grid` test — "leaving grid has no restored note" — touches only `p.descriptor.toast`, which is valid on both arms of the widened union, so it needs no narrowing.)

5. Add the new describe:

```ts
describe('planCommand — review control', () => {
  function reviewFixture() {
    const base = fixture()
    const s = addTerminal(base.s, base.f1, {
      name: 'review: claude', kind: 'claude',
      review: { originTerminalId: base.t1, phase: 'impl', round: 1, maxRounds: 3, reviewDir: '/tmp/r' }
    })
    const reviewerId = s.workspace.groups[0].features[1].terminals[2].id
    return { ...base, s, reviewerId }
  }
  it('review_accept runs only at needs-decision', () => {
    const { s, reviewerId } = reviewFixture()
    expect(planCommand(cmd({ action: 'review_accept' }), s, ctx({ [reviewerId]: 'reviewing' })).type).toBe('error')
    const p = planCommand(cmd({ action: 'review_accept' }), s, ctx({ [reviewerId]: 'needs-decision' }))
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    expect(p.descriptor).toMatchObject({ type: 'review', op: 'accept', reviewerId })
    expect(p.descriptor.toast).toContain('file-panes')
  })
  it('review_more_rounds runs only at needs-decision', () => {
    const { s, reviewerId } = reviewFixture()
    expect(planCommand(cmd({ action: 'review_more_rounds' }), s, ctx({ [reviewerId]: 'reviewing' })).type).toBe('error')
    const p = planCommand(cmd({ action: 'review_more_rounds' }), s, ctx({ [reviewerId]: 'needs-decision' }))
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    expect(p.descriptor).toMatchObject({ type: 'review', op: 'more-rounds', reviewerId })
  })
  it('review_stop → confirm with a review descriptor', () => {
    const { s, reviewerId } = reviewFixture()
    const p = planCommand(cmd({ action: 'review_stop' }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    expect(p.descriptor).toMatchObject({ type: 'review', op: 'stop', reviewerId })
    expect(p.summary).toContain('file-panes')
  })
  it('review actions in a feature without a reviewer → error', () => {
    const { s, f2 } = fixture()
    expect(planCommand(cmd({ action: 'review_accept', featureId: f2 }), s, ctx()).type).toBe('error')
    expect(planCommand(cmd({ action: 'review_stop', featureId: f2 }), s, ctx()).type).toBe('error')
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: the 4 new tests FAIL (the Task 1 stub answers `review_*` with an error plan, so the run/confirm narrowings throw). The existing tests still pass (the extra `ctx()` argument is ignored at runtime until Step 3 lands).

- [ ] **Step 3: Implement context, descriptor, and the review cases**

In `src/renderer/src/voice/executor.ts`:

1. Add `import type { ReviewStatus } from '@shared/types'` (extend the existing `@shared/types` type import).
2. After the `StateDescriptor` type add:

```ts
// Review-loop control delegated to useReview via App (effectful, like
// closeTerminal/addTerminal — never reimplemented here).
export type ReviewDescriptor = {
  type: 'review'
  op: 'accept' | 'more-rounds' | 'stop'
  reviewerId: string
  toast: string
}
```

3. Extend the unions:

```ts
export type ExecDescriptor =
  | StateDescriptor
  | ReviewDescriptor
  | { type: 'closeTerminal'; terminalId: string }
  | { type: 'addTerminal'; featureId: string; kind: TerminalKind; name?: string; prompt?: string }

export type ExecPlan =
  | { type: 'run'; descriptor: StateDescriptor | ReviewDescriptor }
  | { type: 'confirm'; summary: string; editablePrompt?: string; descriptor: ExecDescriptor }
  | { type: 'error'; message: string }
```

4. Add the context type and thread it through (merge with send_prompt's `PlanContext` if it already exists):

```ts
// Live App-owned UI state the planner needs but AppState doesn't hold.
export interface PlanContext {
  reviewStatus: Record<string, ReviewStatus | undefined>
}

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

5. Remove the three `review_*` labels from the Task 1 stub case (the stub keeps the other four labels) and add the real cases to the switch (before `case 'unknown'`):

```ts
    case 'review_accept':
    case 'review_more_rounds':
    case 'review_stop': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('No feature selected')
      const reviewer = f.terminals.find((t) => !!t.review)
      if (!reviewer) return err(`No review running in "${f.name}"`)
      // Accept/more-rounds are meaningful exactly when the loop paused for a
      // decision (the GUI shows those buttons only then — FeatureHeader):
      // mid-review, accept would tear down the reviewer and discard its
      // in-flight critique, and moreRounds would inject a second request into
      // the reviewer's PTY. Stop is always available, like the GUI's Stop.
      if (cmd.action !== 'review_stop' && ctx.reviewStatus[reviewer.id] !== 'needs-decision') {
        return err('Review is not waiting for a decision')
      }
      if (cmd.action === 'review_accept') {
        return {
          type: 'run',
          descriptor: { type: 'review', op: 'accept', reviewerId: reviewer.id, toast: `Review accepted: ${f.name}` }
        }
      }
      if (cmd.action === 'review_more_rounds') {
        return {
          type: 'run',
          descriptor: { type: 'review', op: 'more-rounds', reviewerId: reviewer.id, toast: `More review rounds: ${f.name}` }
        }
      }
      return {
        type: 'confirm',
        summary: `Stop the review in "${f.name}"`,
        descriptor: { type: 'review', op: 'stop', reviewerId: reviewer.id, toast: `Review stopped: ${f.name}` }
      }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: all PASS (including the 15 updated existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/executor.ts src/renderer/src/voice/executor.test.ts
git commit -m "feat(voice): review control actions in the executor behind PlanContext"
```

---

### Task 4: run.ts review routing + useVoice/App wiring

**Files:**
- Modify: `src/renderer/src/voice/run.ts`
- Modify: `src/renderer/src/voice/useVoice.ts`
- Modify: `src/renderer/src/App.tsx:312-316` (the `useVoice` call)
- Test: `src/renderer/src/voice/run.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/voice/run.test.ts`, extend the `deps` helper:

```ts
const deps = (s: AppState) => ({
  state: s,
  apply: vi.fn(),
  markStarted: vi.fn(),
  stopReviewLoop: vi.fn(),
  acceptPhase: vi.fn(),
  moreRounds: vi.fn(),
  launchAgent: vi.fn()
})
```

Add inside `describe('runDescriptor', ...)`:

```ts
  it('review accept / more-rounds / stop route to the review deps, never apply', () => {
    const { s } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'review', op: 'accept', reviewerId: 'r1', toast: 'x' }, d)
    expect(d.acceptPhase).toHaveBeenCalledWith('r1')
    runDescriptor({ type: 'review', op: 'more-rounds', reviewerId: 'r1', toast: 'x' }, d)
    expect(d.moreRounds).toHaveBeenCalledWith('r1')
    runDescriptor({ type: 'review', op: 'stop', reviewerId: 'r1', toast: 'x' }, d)
    expect(d.stopReviewLoop).toHaveBeenCalledWith('r1')
    expect(d.apply).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/voice/run.test.ts`
Expected: the new test FAILS (`runDescriptor` has no `review` branch; the descriptor falls into the addTerminal tail and throws or calls the wrong dep). Existing tests pass.

- [ ] **Step 3: Implement run.ts routing**

In `src/renderer/src/voice/run.ts`, extend `RunDeps`:

```ts
export interface RunDeps {
  state: AppState
  apply: (fn: (s: AppState) => AppState) => void
  markStarted: (id: string) => void
  stopReviewLoop: (terminalId: string) => void
  acceptPhase: (reviewerId: string) => void
  moreRounds: (reviewerId: string) => void
  launchAgent: (featureId: string, kind: AgentKind, opts?: { prompt?: string; name?: string }) => void
}
```

In `runDescriptor`, after the `state` branch add:

```ts
  if (d.type === 'review') {
    if (d.op === 'accept') deps.acceptPhase(d.reviewerId)
    else if (d.op === 'more-rounds') deps.moreRounds(d.reviewerId)
    else deps.stopReviewLoop(d.reviewerId)
    return
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/voice/run.test.ts`
Expected: all PASS.

- [ ] **Step 5: Wire useVoice and App**

In `src/renderer/src/voice/useVoice.ts`:

1. Add `import type { ReviewStatus } from '@shared/types'`.
2. Extend `VoiceDeps`:

```ts
export interface VoiceDeps {
  state: AppState
  apply: (fn: (s: AppState) => AppState) => void
  markStarted: (id: string) => void
  stopReviewLoop: (terminalId: string) => void
  acceptPhase: (reviewerId: string) => void
  moreRounds: (reviewerId: string) => void
  launchAgent: (featureId: string, kind: AgentKind, opts?: { prompt?: string; name?: string }) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
}
```

3. In the `onVoiceResult` effect, pass the context:

```ts
    const plan = planCommand(command, depsRef.current.state, { reviewStatus: depsRef.current.reviewStatus })
```

4. In `confirm`, generalize the toast line (review descriptors carry their own toast):

```ts
    const toast = 'toast' in d ? d.toast : d.type === 'closeTerminal' ? 'Terminal closed' : 'Terminal launched'
```

5. Still in `confirm`, re-check the review gate at confirm time. The executor's `needs-decision` gate runs at PLAN time; a low-confidence "prihvati review" / "još rundi" sits in the confirm overlay while the loop can move on (e.g. the user clicks More rounds in the UI and the reviewer re-enters `reviewing`) — a late confirm would then double-prompt or tear down a busy reviewer, exactly what the gate exists to prevent (`useReview.moreRounds` only no-ops when the reviewer terminal is GONE, not when its status changed). Add right after the `addTerminal` edited-prompt block, before `runDescriptor`:

```ts
    // The executor's needs-decision gate is plan-time state; re-check it now —
    // the loop may have moved on while the confirm overlay sat open. Dispatch
    // 'executed' (not 'plan-error': the reducer ignores plan-error outside
    // active states) so the overlay resolves into an explanatory toast.
    if (d.type === 'review' && d.op !== 'stop'
      && depsRef.current.reviewStatus[d.reviewerId] !== 'needs-decision') {
      dispatch({ type: 'executed', toast: 'Review is no longer waiting for a decision' })
      return
    }
```

(The same stale-window class exists for every confirm descriptor — e.g. `closeTerminal` on an already-removed terminal — but those degrade to no-ops downstream; review descriptors are the only ones where a stale confirm performs a HARMFUL action, hence the targeted guard.)

In `src/renderer/src/App.tsx`, extend the `useVoice` call:

```ts
  const voice = useVoice({
    state, apply, markStarted,
    stopReviewLoop: (id) => review.stopLoop(id),
    acceptPhase: (id) => review.acceptPhase(id),
    moreRounds: (id) => void review.moreRounds(id),
    launchAgent,
    reviewStatus
  })
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx vitest run src/renderer/src/voice`
Expected: typecheck clean, all voice tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/voice/run.ts src/renderer/src/voice/run.test.ts src/renderer/src/voice/useVoice.ts src/renderer/src/App.tsx
git commit -m "feat(voice): route review descriptors through App's review loop handlers"
```

---

### Task 5: Executor — `cycle_tab` and `close_tabs`

**Files:**
- Modify: `src/renderer/src/voice/executor.ts`
- Test: `src/renderer/src/voice/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/voice/executor.test.ts`, add:

```ts
describe('planCommand — tab actions', () => {
  it('cycle_tab next moves to the following terminal with startIds', () => {
    let { s, t1, t2 } = fixture()
    s = setActiveTerminal(s, t1)
    const p = planCommand(cmd({ action: 'cycle_tab', direction: 'next' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.startIds).toEqual([t2])
    expect(p.descriptor.run(s).activeTerminalId).toBe(t2)
  })
  it('cycle_tab lands on a file pane without startIds (direction defaults to next)', () => {
    let { s, f1, t2 } = fixture()
    s = openFile(s, f1, { path: '/code/readme.md' })
    s = setActiveTerminal(s, t2)
    const p = planCommand(cmd({ action: 'cycle_tab' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.startIds).toBeUndefined()
    expect(p.descriptor.run(s).activeTerminalId).toBe(s.workspace.groups[0].features[1].files![0].id)
  })
  it('cycle_tab with no visible panes → error', () => {
    let { s, f2 } = fixture()
    s = setActiveFeature(s, f2) // 'voice' has no terminals
    expect(planCommand(cmd({ action: 'cycle_tab', direction: 'next' }), s, ctx()).type).toBe('error')
  })
  it('close_tabs others keeps the active tab, hides terminals and closes file panes', () => {
    let { s, f1, t1, t2 } = fixture()
    s = openFile(s, f1, { path: '/code/readme.md' })
    s = setActiveTerminal(s, t1)
    const p = planCommand(cmd({ action: 'close_tabs', scope: 'others' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    const after = p.descriptor.run(s)
    expect(after.hidden).toContain(t2)
    expect(after.hidden).not.toContain(t1)
    expect(after.workspace.groups[0].features[1].files).toEqual([])
    expect(after.activeTerminalId).toBe(t1)
    expect(p.descriptor.toast).toContain('2')
  })
  it('close_tabs right hides only tabs after the active one', () => {
    let { s, t1, t2 } = fixture()
    s = setActiveTerminal(s, t1)
    const p = planCommand(cmd({ action: 'close_tabs', scope: 'right' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.run(s).hidden).toEqual([t2])
  })
  it('close_tabs with a NAMED terminal keeps it, hides the rest, activates it', () => {
    const { s, t1, t2 } = fixture() // active = t2 (last added)
    const p = planCommand(cmd({ action: 'close_tabs', terminalId: t1 }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    const after = p.descriptor.run(s)
    expect(after.hidden).toEqual([t2])
    expect(after.activeTerminalId).toBe(t1)
    expect(p.descriptor.startIds).toEqual([t1])
  })
  it('close_tabs with nothing to close → error', () => {
    let { s, t1 } = fixture()
    s = setActiveTerminal(s, t1)
    expect(planCommand(cmd({ action: 'close_tabs', scope: 'left' }), s, ctx()).type).toBe('error')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: the 7 new tests FAIL (no `cycle_tab`/`close_tabs` cases). Existing tests pass.

- [ ] **Step 3: Implement the cases**

In `src/renderer/src/voice/executor.ts`, extend the `../store` import with `closeFile`, `featureIdOfTerminal`, `findFilePane`, `visiblePanes`, `cyclePane`. Remove the `cycle_tab`/`close_tabs` labels from the Task 1 stub case (it keeps `add_feature`/`archive_feature` until Task 6) and add to the switch:

```ts
    case 'cycle_tab': {
      const dir = cmd.direction === 'prev' ? -1 : 1
      const next = cyclePane(s, dir)
      if (!next) return err('No tabs to cycle')
      const name = next.file
        ? findFilePane(s, next.id)?.pane.name ?? 'file'
        : getTerminalById(s, next.id)?.name ?? ''
      return {
        type: 'run',
        descriptor: {
          type: 'state',
          run: (st) => setActiveTerminal(st, next.id),
          toast: `→ ${name}`,
          ...(next.file ? {} : { startIds: [next.id] })
        }
      }
    }
    case 'close_tabs': {
      // The kept tab: a named terminal, else the active pane (terminal or file).
      const anchorId = cmd.terminalId ?? s.activeTerminalId
      if (!anchorId) return err('No tab to keep')
      const anchorTerm = getTerminalById(s, anchorId)
      if (cmd.terminalId && !anchorTerm) return err('Terminal not found — try again')
      const panes = visiblePanes(s, anchorTerm ? featureIdOfTerminal(s, anchorId) ?? undefined : undefined)
      const scope = cmd.scope ?? 'others'
      const idx = panes.findIndex((p) => p.id === anchorId)
      const targets =
        scope === 'others' ? panes.filter((p) => p.id !== anchorId)
        : idx === -1 ? []
        : scope === 'left' ? panes.slice(0, idx)
        : panes.slice(idx + 1)
      if (targets.length === 0) return err('No tabs to close')
      const keptName = anchorTerm?.name ?? findFilePane(s, anchorId)?.pane.name ?? ''
      return {
        type: 'run',
        descriptor: {
          type: 'state',
          run: (st) => {
            const closed = targets.reduce((acc, p) => (p.file ? closeFile(acc, p.id) : hideTerminal(acc, p.id)), st)
            // A terminal anchor may itself be hidden ("zatvori sve osim X"):
            // showTerminal both un-hides and activates it.
            return anchorTerm ? showTerminal(closed, anchorId) : closed
          },
          toast: `Closed ${targets.length} tab${targets.length === 1 ? '' : 's'} — kept ${keptName}`,
          ...(anchorTerm ? { startIds: [anchorId] } : {})
        }
      }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/executor.ts src/renderer/src/voice/executor.test.ts
git commit -m "feat(voice): cycle_tab and close_tabs actions"
```

---

### Task 6: Executor — `add_feature` and `archive_feature`

**Files:**
- Modify: `src/renderer/src/voice/executor.ts`
- Test: `src/renderer/src/voice/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/voice/executor.test.ts`, add:

```ts
describe('planCommand — feature lifecycle', () => {
  it('add_feature → confirm; run appends and activates the feature in the named project', () => {
    const { s } = fixture()
    const gid = s.workspace.groups[0].id
    const p = planCommand(cmd({ action: 'add_feature', groupId: gid, name: 'search' }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.summary).toContain('search')
    expect(p.summary).toContain('mappit')
    const after = p.descriptor.run(s)
    expect(after.workspace.groups[0].features.map((f) => f.name)).toContain('search')
    expect(after.activeFeatureId).toBe(after.workspace.groups[0].features.at(-1)!.id)
  })
  it('add_feature defaults to the active project and requires a name', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'add_feature' }), s, ctx()).type).toBe('error')
    expect(planCommand(cmd({ action: 'add_feature', name: 'search' }), s, ctx()).type).toBe('confirm')
  })
  it('archive_feature → confirm; run moves the feature to the group archive', () => {
    const { s, f2 } = fixture()
    const p = planCommand(cmd({ action: 'archive_feature', featureId: f2 }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.summary).toContain('voice')
    const after = p.descriptor.run(s)
    expect(after.workspace.groups[0].features.map((f) => f.id)).not.toContain(f2)
    expect((after.workspace.groups[0].archivedFeatures ?? []).map((f) => f.id)).toContain(f2)
  })
  it('archive_feature defaults to the active feature', () => {
    const { s } = fixture() // f1 ('file-panes') is active
    const p = planCommand(cmd({ action: 'archive_feature' }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    expect(p.summary).toContain('file-panes')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: the 4 new tests FAIL. Existing tests pass.

- [ ] **Step 3: Implement the cases**

In `src/renderer/src/voice/executor.ts`, extend the `../store` import with `addFeature`, `archiveFeature`. Delete the Task 1 stub case entirely (these are its last two labels) and add to the switch:

```ts
    case 'add_feature': {
      if (!cmd.name) return err('No feature name understood')
      const gid = cmd.groupId ?? s.activeGroupId
      const g = gid ? s.workspace.groups.find((x) => x.id === gid) : null
      if (!g) return err('No project to add the feature to')
      const name = cmd.name
      return {
        type: 'confirm',
        summary: `New feature "${name}" in project "${g.name}"`,
        descriptor: { type: 'state', run: (st) => addFeature(st, g.id, name), toast: `Feature created: ${name}` }
      }
    }
    case 'archive_feature': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('Feature not found — try again')
      return {
        type: 'confirm',
        summary: `Archive feature "${f.name}"? Its terminals will close.`,
        descriptor: { type: 'state', run: (st) => archiveFeature(st, f.id), toast: `Archived: ${f.name}` }
      }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/executor.ts src/renderer/src/voice/executor.test.ts
git commit -m "feat(voice): add_feature and archive_feature actions"
```

---

### Task 7: Intent prompt — teach the LLM the new actions

**Files:**
- Modify: `src/main/voice/intent.ts` (the system prompt in `buildIntentMessages`)
- Test: `src/main/voice/intent.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/voice/intent.test.ts`, add inside `describe('buildIntentMessages', ...)`:

```ts
  it('teaches the batch-2 actions and their fields', () => {
    const [system] = buildIntentMessages('x', snap)
    for (const a of ['cycle_tab', 'close_tabs', 'add_feature', 'archive_feature',
                     'review_accept', 'review_more_rounds', 'review_stop']) {
      expect(system.content).toContain(a)
    }
    expect(system.content).toContain('"direction"')
    expect(system.content).toContain('"scope"')
    expect(system.content).toContain('"groupId"')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/voice/intent.test.ts`
Expected: the new test FAILS. Existing tests pass.

- [ ] **Step 3: Update the system prompt**

In `src/main/voice/intent.ts` inside `buildIntentMessages`:

1. Replace the JSON shape block (keep `send_prompt` in the enum if already present):

```
{"action": "switch_feature|toggle_grid|switch_tab|set_grid_style|hide_terminal|add_terminal|close_terminal|rename_feature|rename_terminal|cycle_tab|close_tabs|add_feature|archive_feature|review_accept|review_more_rounds|review_stop|unknown",
 "featureId"?: string, "terminalId"?: string, "groupId"?: string, "kind"?: "shell|claude|codex",
 "prompt"?: string, "name"?: string,
 "gridStyle"?: "auto|auto-left|auto-top|auto-bottom|rows|cols",
 "direction"?: "next|prev", "scope"?: "others|left|right",
 "confidence": "high|low"}
```

2. Append to the Rules list (before the final "If the utterance is not one of these commands" rule):

```
- cycle_tab: "sledeći/sljedeći tab", "prethodni tab", "next/previous tab" → direction "next"|"prev".
- close_tabs: bulk-hide tabs around ONE kept tab. "zatvori ostale tabove" → scope "others"; "zatvori tabove levo/desno" ("to the left/right") → scope "left"|"right". When the user names the terminal to KEEP ("zatvori sve osim klode"), put its id in terminalId; otherwise omit terminalId (the active tab is kept).
- add_feature: creates a new feature; "name" is the spoken feature name, "groupId" is the named project's id (omit groupId when no project is named — the active one is used).
- archive_feature: "arhiviraj <feature>" moves the feature to its project's archive; featureId defaults to the active feature.
- review_accept / review_more_rounds / review_stop control the running review loop of a feature ("prihvati review", "još rundi", "zaustavi/prekini review"); featureId defaults to the active feature.
```

3. Append to the Examples list:

```
"sledeći tab" → {"action":"cycle_tab","direction":"next","confidence":"high"}
"zatvori ostale tabove" → {"action":"close_tabs","scope":"others","confidence":"high"}
"zatvori sve tabove osim kloda" → {"action":"close_tabs","terminalId":"<id of terminal claude>","confidence":"high"}
"napravi novi feature search u mapitu" → {"action":"add_feature","groupId":"<id of mappit>","name":"search","confidence":"high"}
"arhiviraj file panes" → {"action":"archive_feature","featureId":"<id of file-panes>","confidence":"high"}
"prihvati review" → {"action":"review_accept","confidence":"high"}
"daj još rundi review-a" → {"action":"review_more_rounds","confidence":"high"}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/voice/intent.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/intent.ts src/main/voice/intent.test.ts
git commit -m "feat(voice): teach the intent prompt the batch-2 actions"
```

---

### Task 8: README line + full verification

**Files:**
- Modify: `README.md:119`

- [ ] **Step 1: Update the voice feature line**

In `README.md`, extend the voice bullet's capability list. Current text fragment: `switch features, toggle the grid, launch agent terminals with a spoken prompt.` New fragment:

```
switch features, toggle the grid, launch agent terminals with a spoken prompt, drive review loops (accept / more rounds / stop), cycle and bulk-close tabs, create or archive features.
```

- [ ] **Step 2: Full verification**

Run: `npm test`
Expected: ALL suites pass.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(voice): README feature line covers batch-2 actions"
```

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch (merge/PR decision per the project's workflow: feature branch → `--no-ff` merge → confirm with the user before pushing to master). If `voice-send-prompt` landed on `develop` meanwhile, rebase and apply the PlanContext merge notes from the Coordination section first.

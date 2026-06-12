# Parallel Dual Review (claude + codex) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let claude and codex review the same origin terminal in parallel, each with its own independent round loop, with the origin going green only when ALL reviewers approve.

**Architecture:** Two phases. Phase A re-keys the critique file path per agent kind (`reviews/<originId>/<agentKind>/review-<phase>-<round>.md`) while `intent.md`/`spec.md` stay shared in the origin folder — safe and mergeable on its own. Phase B replaces the single-reviewer assumptions: a per-origin apply-cycle queue serializes NEEDS-WORK relays, all applied reviewers advance together when the origin settles, the origin's status aggregates across reviewers, and the UI renders one control cluster per reviewer.

**Tech Stack:** Electron (main/preload/renderer), React 18, TypeScript, vitest + @testing-library/react.

**Binding decisions (from the approved intent at `~/.config/brain/reviews/8458240b-838b-45d9-9bb8-acab6958d8cb/intent.md`):**
- ALL active reviewers must approve before the origin goes `approved`.
- An approved reviewer closes and stays closed (no re-verification in v1).
- NEEDS-WORK relays are applied sequentially in arrival order; the origin agent arbitrates conflicting critiques via the existing relay prompt wording.
- Termination: each reviewer independently approves or exhausts its own `maxRounds` → `needs-decision`.
- At most ONE reviewer per agent kind per origin; the dialog disables duplicates and `startReview` guards.
- Existing persisted links (old flat `reviewDir`) keep working: paths rebuild from the persisted `reviewDir`, and advancing a round re-points the link at the freshly resolved dir.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/shared/types.ts` | shared types | add `AgentKind` |
| `src/renderer/src/agents.ts` | agent defs | re-export `AgentKind` from shared |
| `src/main/reviewFs.ts` | review paths on disk | per-agent `reviewDir`; shared intent/spec in origin folder |
| `src/main/ipc.ts` | IPC handlers | thread `reviewer` through `reviewResolveDir` |
| `src/preload/index.ts` | bridge | new `resolveReviewDir` arg |
| `src/shared/api.ts` | bridge types | new `resolveReviewDir` signature |
| `src/renderer/src/review/useReview.ts` | the review loop | pass reviewer kind; apply-cycle queue; advance-all; aggregate origin status |
| `src/renderer/src/store.ts` | state helpers | `findReviewersFor` (plural), drop `findReviewerFor` |
| `src/renderer/src/components/FeatureHeader.tsx` | loop controls | one control cluster per reviewer |
| `src/renderer/src/components/ReviewDialog.tsx` | start dialog | multi-select reviewers; disable active kinds |
| `src/renderer/src/App.tsx` | wiring | reviewer list, dialog args, fan-out start |

Tests live next to each file (`*.test.ts(x)`), runner is vitest: `npx vitest run <file>` for one file, `npm test` for all, `npm run typecheck` for tsc.

## Setup

- [ ] **Step 0.1: Create the feature branch**

```bash
cd /home/miljan/terminaltor
git checkout develop && git pull --ff-only
git checkout -b feat/parallel-review
```

---

# Phase A — per-agent critique subfolder

### Task 1: Shared `AgentKind` type

Main-process code (`reviewFs.ts`, `ipc.ts`) needs the `'claude' | 'codex'` union, but it currently lives in the renderer (`src/renderer/src/agents.ts`), which main must not import. Move it to shared and re-export.

**Files:**
- Modify: `src/shared/types.ts` (after line 1, `TerminalKind`)
- Modify: `src/renderer/src/agents.ts:1-5`

- [ ] **Step 1.1: Add the type to shared/types.ts**

After `export type TerminalKind = 'shell' | 'claude' | 'codex'` insert:

```ts
// The two launchable agent CLIs — the TerminalKind subset that can review.
export type AgentKind = 'claude' | 'codex'
```

- [ ] **Step 1.2: Re-export from agents.ts**

Replace the top of `src/renderer/src/agents.ts`:

```ts
// Quick-launch agent definitions. `command` is assumed to be on PATH.
import type { TerminalKind } from '@shared/types'
import { shellSingleQuote } from './shellQuote'

export type AgentKind = 'claude' | 'codex'
```

with:

```ts
// Quick-launch agent definitions. `command` is assumed to be on PATH.
import type { AgentKind, TerminalKind } from '@shared/types'
import { shellSingleQuote } from './shellQuote'

export type { AgentKind }
```

- [ ] **Step 1.3: Verify**

Run: `npm run typecheck`
Expected: no errors (every existing `import type { AgentKind } from '../agents'` keeps working through the re-export).

- [ ] **Step 1.4: Commit**

```bash
git add src/shared/types.ts src/renderer/src/agents.ts
git commit -m "refactor(types): move AgentKind to shared so main can use it"
```

### Task 2: `reviewFs` — per-agent review dir, shared intent/spec

**Files:**
- Modify: `src/main/reviewFs.ts:39-58`
- Test: `src/main/reviewFs.test.ts:20-27, 58-70`

- [ ] **Step 2.1: Update the failing tests**

In `src/main/reviewFs.test.ts` replace the `reviewDirFor / reviewFilePath` describe block with:

```ts
describe('reviewDirFor / reviewFilePath', () => {
  it('keys the dir by origin id AND reviewer kind under reviews/', () => {
    expect(reviewDirFor('/data', 'abc', 'claude')).toBe(join('/data', 'reviews', 'abc', 'claude'))
    expect(reviewDirFor('/data', 'abc', 'codex')).toBe(join('/data', 'reviews', 'abc', 'codex'))
  })
  it('names review files review-<phase>-<round>.md', () => {
    expect(reviewFilePath('/data/reviews/abc/codex', 'spec', 2)).toBe(join('/data/reviews/abc/codex', 'review-spec-2.md'))
  })
})
```

and replace the `resolveReviewPaths` describe block with:

```ts
describe('resolveReviewPaths', () => {
  it('mkdir -p the per-agent dir; intent/spec stay SHARED in the origin folder', async () => {
    const base = await mktmp()
    const { reviewDir, reviewFile, intentPath, specPath } = await resolveReviewPaths(base, 'tid', 'codex', 'intent', 1)
    expect(reviewDir).toBe(join(base, 'reviews', 'tid', 'codex'))
    expect(reviewFile).toBe(join(base, 'reviews', 'tid', 'codex', 'review-intent-1.md'))
    expect(intentPath).toBe(join(base, 'reviews', 'tid', 'intent.md'))
    expect(specPath).toBe(join(base, 'reviews', 'tid', 'spec.md'))
    const stat = await fs.stat(reviewDir)
    expect(stat.isDirectory()).toBe(true)
    await fs.rm(base, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx vitest run src/main/reviewFs.test.ts`
Expected: FAIL — `reviewDirFor`/`resolveReviewPaths` don't accept the reviewer argument yet.

- [ ] **Step 2.3: Implement**

In `src/main/reviewFs.ts` change the import on line 3 and replace lines 39-58:

```ts
import type { ReviewPhase, AgentKind } from '@shared/types'
```

```ts
export function reviewDirFor(userDataDir: string, originTerminalId: string, reviewer: AgentKind): string {
  return join(userDataDir, 'reviews', originTerminalId, reviewer)
}

export function reviewFilePath(reviewDir: string, phase: ReviewPhase, round: number): string {
  return join(reviewDir, `review-${phase}-${round}.md`)
}

export async function resolveReviewPaths(
  userDataDir: string, originTerminalId: string, reviewer: AgentKind, phase: ReviewPhase, round: number
): Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }> {
  const reviewDir = reviewDirFor(userDataDir, originTerminalId, reviewer)
  // intent.md / spec.md are the ORIGIN's artifacts — every reviewer reads the
  // same documents, so they live in the origin folder, not the per-agent one.
  const originDir = join(userDataDir, 'reviews', originTerminalId)
  await fs.mkdir(reviewDir, { recursive: true })
  return {
    reviewDir,
    reviewFile: reviewFilePath(reviewDir, phase, round),
    intentPath: join(originDir, 'intent.md'),
    specPath: join(originDir, 'spec.md')
  }
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx vitest run src/main/reviewFs.test.ts`
Expected: PASS. (`npm run typecheck` will fail until Task 3 updates the callers — that's expected mid-stack; do NOT commit yet.)

### Task 3: Thread `reviewer` through the IPC bridge and its callers

One mechanical change across the bridge so the tree compiles again. Commit together with Task 2's change.

**Files:**
- Modify: `src/shared/api.ts:28`
- Modify: `src/preload/index.ts:48-49`
- Modify: `src/main/ipc.ts:109-110`
- Modify: `src/renderer/src/review/useReview.ts:77, 167, 213`
- Test: `src/renderer/src/review/useReview.test.tsx:12-17, 179`

- [ ] **Step 3.1: shared/api.ts**

Change the import and the signature:

```ts
import type { AgentKind, ReviewPhase } from './types'
```

```ts
  resolveReviewDir(originTerminalId: string, reviewer: AgentKind, phase: ReviewPhase, round: number): Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }>
```

- [ ] **Step 3.2: preload/index.ts**

```ts
  resolveReviewDir: (originTerminalId, reviewer, phase, round) =>
    ipcRenderer.invoke(IPC.reviewResolveDir, { originTerminalId, reviewer, phase, round }) as Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }>,
```

- [ ] **Step 3.3: main/ipc.ts**

```ts
  ipcMain.handle(IPC.reviewResolveDir, (_e, p: { originTerminalId: string; reviewer?: AgentKind; phase: ReviewPhase; round: number }) =>
    resolveReviewPaths(userDataDir, p.originTerminalId, p.reviewer === 'codex' ? 'codex' : 'claude', p.phase, p.round))
```

Add `AgentKind` to the existing `@shared/types` type import in `ipc.ts`.

- [ ] **Step 3.4: useReview.ts call sites**

Line 77 (startReview):

```ts
    const paths = await window.brain.resolveReviewDir(a.originTerminalId, a.reviewer, a.phase, round)
```

Line 167 (handleBusy) — the reviewer terminal's own kind drives the dir:

```ts
    const kind: AgentKind = reviewer.kind === 'codex' ? 'codex' : 'claude'
    const paths = await window.brain.resolveReviewDir(id, kind, link.phase, decision.round)
```

Line 213 (moreRounds):

```ts
    const kind: AgentKind = reviewer.kind === 'codex' ? 'codex' : 'claude'
    const paths = await window.brain.resolveReviewDir(link.originTerminalId, kind, link.phase, round)
```

`AgentKind` is already imported in useReview.ts via `import { agentLaunchCommand, type AgentKind } from '../agents'`.

- [ ] **Step 3.5: Update the test mock and assertion**

In `src/renderer/src/review/useReview.test.tsx` line 12, give the mock the new arity:

```ts
  resolveReviewDir: vi.fn(async (_origin: string, _reviewer: string, phase: string, round: number) => ({
    reviewDir: '/rd',
    reviewFile: `/rd/review-${phase}-${round}.md`,
    intentPath: '/rd/intent.md',
    specPath: '/rd/spec.md'
  })),
```

Line 179 (apply-hold test; the fixture reviewer `rev` has `kind: 'codex'`):

```ts
    expect(api.resolveReviewDir).toHaveBeenCalledWith('origin', 'codex', 'impl', 3) // now it advances
```

- [ ] **Step 3.6: Verify**

Run: `npx vitest run src/renderer/src/review/useReview.test.tsx src/main/reviewFs.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 3.7: Commit (Tasks 2+3 together — one compiling unit)**

```bash
git add src/main/reviewFs.ts src/main/reviewFs.test.ts src/main/ipc.ts src/shared/api.ts src/preload/index.ts src/renderer/src/review/useReview.ts src/renderer/src/review/useReview.test.tsx
git commit -m "feat(review): key critique files by agent kind — reviews/<origin>/<agent>/"
```

### Task 4: Re-point `link.reviewDir` when a round advances (upgrade compatibility)

A link persisted under the old flat layout keeps watching its old dir (correct — the reviewer was told to write there). The first round advance after the upgrade resolves the NEW per-agent dir; the link must follow it, or a renderer reload would re-arm the watch on the stale path while the reviewer writes to the new one.

**Files:**
- Modify: `src/renderer/src/review/useReview.ts:168, 214`
- Test: `src/renderer/src/review/useReview.test.tsx` (new test in the apply-hold describe)

- [ ] **Step 4.1: Write the failing test**

Add to the `useReview apply-hold on a blocked origin` describe block:

```ts
  it('re-points the link reviewDir at the freshly resolved dir when advancing', async () => {
    api.resolveReviewDir.mockResolvedValueOnce({
      reviewDir: '/rd2/codex',
      reviewFile: '/rd2/codex/review-impl-3.md',
      intentPath: '/rd2/intent.md',
      specPath: '/rd2/spec.md'
    })
    const { result, apply } = setup()
    await act(async () => {})
    await reachApplying(result)
    registerTail('origin', () => 'All changes applied.')
    await act(() => result.current.handleBusy('origin', true))
    await act(() => result.current.handleBusy('origin', false))
    const updater = apply.mock.calls.at(-1)![0]
    const next = updater(mkState())
    const reviewer = next.workspace.groups[0].features[0].terminals.find((t: { review?: unknown }) => t.review)
    expect(reviewer?.review).toMatchObject({ round: 3, reviewDir: '/rd2/codex' })
    expect(api.watchFile).toHaveBeenCalledWith('review:rev:impl:3', '/rd2/codex/review-impl-3.md')
  })
```

- [ ] **Step 4.2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/review/useReview.test.tsx`
Expected: FAIL — `reviewDir` stays `/rd`.

- [ ] **Step 4.3: Implement**

handleBusy (was line 168):

```ts
    apply((s) => patchReviewLink(s, reviewer.id, { round: decision.round, reviewDir: paths.reviewDir }))
```

moreRounds (was line 214):

```ts
    apply((s) => patchReviewLink(s, reviewer.id, { round, maxRounds, reviewDir: paths.reviewDir }))
```

- [ ] **Step 4.4: Run tests, verify PASS, commit**

```bash
npx vitest run src/renderer/src/review/useReview.test.tsx
git add src/renderer/src/review/useReview.ts src/renderer/src/review/useReview.test.tsx
git commit -m "fix(review): follow the resolved review dir when a round advances"
```

### Task 5: Reviewer terminal name carries the agent kind

Two reviewers on one origin would otherwise both be named `review: <origin>` — indistinguishable tabs.

**Files:**
- Modify: `src/renderer/src/review/useReview.ts:97`
- Test: `src/renderer/src/review/useReview.test.tsx:119-131`

- [ ] **Step 5.1: Update the naming test**

```ts
describe('useReview reviewer naming', () => {
  it('names the reviewer with its agent kind and the origin terminal name', async () => {
    const state = mkState(false)
    state.workspace.groups[0].features[0].terminals[0].name = 'auth-api'
    const { result, apply } = setup({ state })
    await act(async () => {})
    await act(() => result.current.startReview({ originTerminalId: 'origin', reviewer: 'codex', phase: 'impl', maxRounds: 3 }))
    const updater = apply.mock.calls.at(-1)![0]
    const next = updater(mkState(false))
    const reviewer = next.workspace.groups[0].features[0].terminals.find((t: { review?: unknown }) => t.review)
    expect(reviewer?.name).toBe('codex review: auth-api')
  })
})
```

- [ ] **Step 5.2: Run to verify it fails, then implement**

In startReview (line 97) change:

```ts
      id: reviewerId, name: `review: ${origin?.name ?? a.reviewer}`, kind: a.reviewer,
```

to:

```ts
      id: reviewerId, name: `${a.reviewer} review: ${origin?.name ?? a.reviewer}`, kind: a.reviewer,
```

- [ ] **Step 5.3: Run tests, verify PASS, commit**

```bash
npx vitest run src/renderer/src/review/useReview.test.tsx
git add src/renderer/src/review/useReview.ts src/renderer/src/review/useReview.test.tsx
git commit -m "feat(review): reviewer terminal name carries the agent kind"
```

**End of Phase A — mergeable checkpoint.** Run `npm test && npm run typecheck`; everything green.

---

# Phase B — the parallel loop

### Task 6: `findReviewersFor` (plural) in the store

**Files:**
- Modify: `src/renderer/src/store.ts:559-560` (add plural; keep singular until Task 7 removes its last caller)
- Test: `src/renderer/src/store.test.ts:472-490`

- [ ] **Step 6.1: Write the failing test**

Add next to the existing `findReviewerFor` test (~line 472), reusing that test's state-building style:

```ts
  it('findReviewersFor returns every reviewer of an origin, in tree order', () => {
    let s = base()
    const aId = s.workspace.groups[0].features[0].terminals[0].id
    s = addTerminal(s, 'f1', { id: 'r1', name: 'claude review', kind: 'claude', review: { originTerminalId: aId, phase: 'impl', round: 1, maxRounds: 3, reviewDir: '/rd/claude' } })
    s = addTerminal(s, 'f1', { id: 'r2', name: 'codex review', kind: 'codex', review: { originTerminalId: aId, phase: 'impl', round: 1, maxRounds: 3, reviewDir: '/rd/codex' } })
    expect(findReviewersFor(s, aId).map((t) => t.id)).toEqual(['r1', 'r2'])
    expect(findReviewersFor(s, 'nope')).toEqual([])
  })
```

NOTE: mirror the surrounding tests' actual state helper and feature id — read the existing `findReviewerFor` test first and copy its setup exactly (the names `base()`/`'f1'` above stand for whatever that test really uses; the assertions are the contract).

- [ ] **Step 6.2: Run to verify it fails, then implement**

In `src/renderer/src/store.ts` add below `findReviewerFor`:

```ts
export const findReviewersFor = (s: AppState, originId: string): Terminal[] =>
  allTerminals(s).filter((t) => t.review?.originTerminalId === originId)
```

- [ ] **Step 6.3: Run tests, verify PASS, commit**

```bash
npx vitest run src/renderer/src/store.test.ts
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(store): findReviewersFor — all reviewers of an origin"
```

### Task 7: Apply-cycle queue — serialize relays, advance ALL applied reviewers

The core change. `awaiting` becomes a per-origin apply cycle: the first NEEDS-WORK relays immediately; further ones queue. Each origin busy→idle either relays the next queued critique (staying in the cycle) or — when the queue is empty — advances every reviewer whose critique was applied.

**Files:**
- Modify: `src/renderer/src/review/useReview.ts:33-34, 138-143, 146-170`
- Test: `src/renderer/src/review/useReview.test.tsx` (new describe + dual-state helper)

- [ ] **Step 7.1: Write the failing tests**

Add to `useReview.test.tsx` (top level, after `mkState`):

```ts
// Two reviewers (claude + codex) bound to the same origin, both at impl round 1.
const mkDualState = (): AppState => ({
  workspace: {
    groups: [{
      id: 'g', name: 'G', cwd: '/p', collapsed: false,
      features: [{
        id: 'f', name: 'F', collapsed: false,
        terminals: [
          { id: 'origin', name: 'claude', cwd: '/p', kind: 'claude' },
          { id: 'revA', name: 'claude review: claude', cwd: '/p', kind: 'claude' as const,
            review: { originTerminalId: 'origin', phase: 'impl' as const, round: 1, maxRounds: 3, reviewDir: '/rd/claude' } },
          { id: 'revB', name: 'codex review: claude', cwd: '/p', kind: 'codex' as const,
            review: { originTerminalId: 'origin', phase: 'impl' as const, round: 1, maxRounds: 3, reviewDir: '/rd/codex' } }
        ]
      }]
    }]
  },
  activeGroupId: 'g', activeFeatureId: 'f', activeTerminalId: 'origin', hidden: []
})

// PTY writes that are prompts (not the delayed CR submit keystroke).
const promptWrites = () => api.writePty.mock.calls.filter((c) => c[1] !== '\r')
```

and the new describe block:

```ts
describe('useReview parallel reviewers', () => {
  it('queues the second critique and advances BOTH reviewers when the origin settles', async () => {
    const { result } = setup({ state: mkDualState() })
    await act(async () => {})  // reconcile arms both watches
    expect(api.watchFile).toHaveBeenCalledWith('review:revA:impl:1', '/rd/claude/review-impl-1.md')
    expect(api.watchFile).toHaveBeenCalledWith('review:revB:impl:1', '/rd/codex/review-impl-1.md')

    api.readTextFile.mockResolvedValue('VERDICT: NEEDS-WORK\n- fix x')
    await act(() => result.current.handleFsChanged('review:revA:impl:1'))
    expect(promptWrites()).toHaveLength(1)              // A's critique relayed
    await act(() => result.current.handleFsChanged('review:revB:impl:1'))
    expect(promptWrites()).toHaveLength(1)              // B queued, not relayed yet

    registerTail('origin', () => 'All changes applied.')
    await act(() => result.current.handleBusy('origin', true))
    await act(() => result.current.handleBusy('origin', false))
    expect(promptWrites()).toHaveLength(2)              // B's critique relayed now
    expect(api.resolveReviewDir).not.toHaveBeenCalled() // nobody advances mid-cycle

    await act(() => result.current.handleBusy('origin', true))
    await act(() => result.current.handleBusy('origin', false))
    expect(api.resolveReviewDir).toHaveBeenCalledWith('origin', 'claude', 'impl', 2)
    expect(api.resolveReviewDir).toHaveBeenCalledWith('origin', 'codex', 'impl', 2)
  })

  it('a reviewer at its cap stops for a decision while the other iterates; origin stays under-review', async () => {
    const s = mkDualState()
    s.workspace.groups[0].features[0].terminals[1].review!.round = 3 // revA at maxRounds
    const { result, setStatus } = setup({ state: s })
    await act(async () => {})
    api.readTextFile.mockResolvedValue('VERDICT: NEEDS-WORK\n- fix x')
    await act(() => result.current.handleFsChanged('review:revA:impl:3'))
    await act(() => result.current.handleFsChanged('review:revB:impl:1'))
    registerTail('origin', () => 'All changes applied.')
    await act(() => result.current.handleBusy('origin', true))
    await act(() => result.current.handleBusy('origin', false))   // relays B's critique
    await act(() => result.current.handleBusy('origin', true))
    await act(() => result.current.handleBusy('origin', false))   // cycle complete
    expect(setStatus).toHaveBeenCalledWith('revA', 'needs-decision')
    expect(api.resolveReviewDir).toHaveBeenCalledWith('origin', 'codex', 'impl', 2)
    const originCalls = setStatus.mock.calls.filter((c) => c[0] === 'origin')
    expect(originCalls.at(-1)).toEqual(['origin', 'under-review']) // NOT cleared
  })

  it('keeps the origin under-review when the only applied reviewer stops while the other is still reviewing', async () => {
    const s = mkDualState()
    s.workspace.groups[0].features[0].terminals[1].review!.round = 3 // revA at maxRounds
    const { result, setStatus } = setup({ state: s })
    await act(async () => {})
    api.readTextFile.mockResolvedValue('VERDICT: NEEDS-WORK\n- fix x')
    await act(() => result.current.handleFsChanged('review:revA:impl:3')) // revB stays silent
    registerTail('origin', () => 'All changes applied.')
    await act(() => result.current.handleBusy('origin', true))
    await act(() => result.current.handleBusy('origin', false))
    expect(setStatus).toHaveBeenCalledWith('revA', 'needs-decision')
    const originCalls = setStatus.mock.calls.filter((c) => c[0] === 'origin')
    expect(originCalls.at(-1)).toEqual(['origin', 'under-review']) // revB still reviewing
  })

  it('reconstructs the apply cycle after a reload with both verdicts already on disk', async () => {
    api.readTextFile.mockResolvedValue('VERDICT: NEEDS-WORK\n- fix x')
    setup({ state: mkDualState() })
    await act(async () => {})
    expect(promptWrites()).toHaveLength(1) // first verdict relays, the second queues
  })
})
```

- [ ] **Step 7.2: Run to verify the new tests fail**

Run: `npx vitest run src/renderer/src/review/useReview.test.tsx`
Expected: FAIL — second relay fires immediately (no queue) and only the `.find()`-first reviewer advances.

- [ ] **Step 7.3: Implement the apply cycle**

In `useReview.ts` replace the `awaiting` declaration (lines 33-34):

```ts
  // originId → in-flight apply cycle: critiques already relayed this cycle
  // (their reviewers advance together when the origin settles) and critiques
  // queued behind the one being applied — two at once would interleave.
  interface ApplyCycle {
    arm: 'pending' | 'working'
    applied: string[]                               // reviewerIds relayed this cycle
    queue: { reviewerId: string; relay: string }[]  // critiques waiting their turn
  }
  const awaiting = useRef(new Map<string, ApplyCycle>())
```

(Declare the `ApplyCycle` interface above the hook, next to `StartReviewArgs`, not inside the function body.)

In `requestReview` (line 54) make the origin status conditional — a late NEEDS-WORK can open a NEW apply cycle on the origin while advance-all is still awaiting `resolveReviewDir`, and an unconditional set would stomp its `applying` badge:

```ts
    submitToPty(reviewerId, prompt)
    setStatus(reviewerId, 'reviewing')
    // Don't stomp 'applying': a late NEEDS-WORK can open a new apply cycle on
    // the origin while advance-all is still awaiting path resolution.
    if (!awaiting.current.has(link.originTerminalId)) setStatus(link.originTerminalId, 'under-review')
    armReviewWatch(reviewerId, reviewFile, phase, round)
```

Replace the NEEDS-WORK tail of `handleFsChanged` (lines 138-143):

```ts
    // NEEDS-WORK → relay to the origin; if the origin is already applying
    // another reviewer's critique, queue this one for the next idle.
    const relay = relayToOriginPrompt({ phase: link.phase, reviewFile: w.reviewFile, intentPath: link.intentPath, specPath: link.specPath })
    setStatus(reviewer.id, undefined)
    const cycle = awaiting.current.get(link.originTerminalId)
    if (cycle) { cycle.queue.push({ reviewerId: reviewer.id, relay }); return }
    submitToPty(link.originTerminalId, relay)
    setStatus(link.originTerminalId, 'applying')
    awaiting.current.set(link.originTerminalId, { arm: 'pending', applied: [reviewer.id], queue: [] })
```

Replace `handleBusy` (lines 146-170) entirely:

```ts
  // 3. Origin busy→idle while applying → relay the next queued critique, or —
  // when the queue is dry — advance EVERY reviewer applied this cycle.
  const handleBusy = useCallback(async (id: string, busy: boolean) => {
    const cycle = awaiting.current.get(id)
    if (!cycle) return
    if (busy) { cycle.arm = 'working'; return }       // origin started producing output
    if (cycle.arm !== 'working') return               // ignore idle before any work began
    // The busy tracker calls 1.5s of output silence "idle", but an origin stopped
    // on a permission prompt is silent too — re-reviewing now would burn a round
    // against unchanged work. Hold: answering the prompt makes the origin busy
    // again, and its next real idle advances the loop.
    if (classifyIdle(readTail(id)) === 'waiting-input') return
    const next = cycle.queue.shift()
    if (next) {
      cycle.applied.push(next.reviewerId)
      cycle.arm = 'pending'
      submitToPty(id, next.relay)
      return
    }
    awaiting.current.delete(id)
    let anyIterating = false
    for (const reviewerId of cycle.applied) {
      const reviewer = getTerminalById(state, reviewerId)
      const link = reviewer?.review
      if (!reviewer || !link) continue
      const decision = afterApply(link.round, link.maxRounds)
      if (decision.type === 'stop') { setStatus(reviewer.id, 'needs-decision'); continue }
      anyIterating = true
      const kind: AgentKind = reviewer.kind === 'codex' ? 'codex' : 'claude'
      const paths = await window.brain.resolveReviewDir(id, kind, link.phase, decision.round)
      apply((s) => patchReviewLink(s, reviewer.id, { round: decision.round, reviewDir: paths.reviewDir }))
      requestReview(link, reviewer.id, link.phase, decision.round, paths.reviewFile)
    }
    // A reviewer whose verdict hasn't landed yet is NOT in this cycle — its
    // armed watch marks it still reviewing, so the origin keeps its badge.
    if (!anyIterating) {
      const stillReviewing = findReviewersFor(state, id).some((r) =>
        [...watching.current.values()].some((w) => w.reviewerId === r.id))
      setStatus(id, stillReviewing ? 'under-review' : undefined)
    }
  }, [state, apply, setStatus, requestReview])
```

NOTE on the still-reviewing check: the spec reviewer proposed `statusRef.current[r.id] === 'reviewing'`; we read `watching.current` instead. The status prop round-trips through App's render and can lag a tick (the same staleness as Blocker 1's `state`), while the watch map is maintained synchronously inside the hook — an armed verdict watch IS the definition of "still reviewing" (queued/applied reviewers were unwatched when their verdict landed). It also keeps the new test deterministic without manually re-rendering with a synthetic `reviewStatus`.

Update the `awaiting`-typed accesses elsewhere in the file: `awaiting.current.set(link.originTerminalId, 'pending')` no longer exists (replaced above); `finalizeApproved`/`stopLoop` deletions stay valid (`Map.delete`); the reconcile guard `awaiting.current.has(link.originTerminalId)` stays valid. In the `../store` import replace `findReviewerFor` with `findReviewersFor` — `handleBusy`'s still-reviewing check uses it from this task on (Task 8 then deletes the singular helper from the store).

- [ ] **Step 7.4: Run the full review suite, verify PASS**

Run: `npx vitest run src/renderer/src/review/ && npm run typecheck`
Expected: PASS — including the pre-existing apply-hold tests (single reviewer = cycle of one).

- [ ] **Step 7.5: Commit**

```bash
git add src/renderer/src/review/useReview.ts src/renderer/src/review/useReview.test.tsx
git commit -m "feat(review): apply-cycle queue — serialize relays, advance all applied reviewers"
```

### Task 8: Aggregate origin status in `finalizeApproved`/`stopLoop`; drop `findReviewerFor`

**Files:**
- Modify: `src/renderer/src/review/useReview.ts:61-69, 226-237`
- Modify: `src/renderer/src/store.ts:559-560` (delete the singular helper)
- Test: `src/renderer/src/review/useReview.test.tsx`, `src/renderer/src/store.test.ts`

- [ ] **Step 8.1: Write the failing tests**

Add to the `useReview parallel reviewers` describe:

```ts
  it('does not mark the origin approved while another reviewer is still active', async () => {
    const { result, apply, setStatus } = setup({ state: mkDualState() })
    await act(async () => {})
    api.readTextFile.mockResolvedValue('VERDICT: APPROVED\nlooks good')
    await act(() => result.current.handleFsChanged('review:revA:impl:1'))
    expect(apply).toHaveBeenCalled() // revA terminal removed
    expect(setStatus).toHaveBeenCalledWith('revA', undefined)
    expect(setStatus).not.toHaveBeenCalledWith('origin', 'approved') // revB still reviewing
  })

  it('stopping one of two reviewers leaves the origin under the other\'s review', async () => {
    const { result, setStatus } = setup({ state: mkDualState() })
    await act(async () => {})
    await act(async () => { result.current.stopLoop('revA') })
    expect(setStatus).toHaveBeenCalledWith('revA', undefined)
    expect(setStatus).not.toHaveBeenCalledWith('origin', undefined)
  })

  it('two APPROVED verdicts in the same tick still green the origin (last one out)', async () => {
    // `state` lags one render behind apply(); without the removed-set both
    // finalize calls would see BOTH reviewers and neither would green the
    // origin. The reconcile-after-reload path hits this for real: it fires
    // handleFsChanged for every link in one pass.
    const { result, setStatus } = setup({ state: mkDualState() })
    await act(async () => {})
    api.readTextFile.mockResolvedValue('VERDICT: APPROVED\nok')
    await act(async () => {
      void result.current.handleFsChanged('review:revA:impl:1')
      void result.current.handleFsChanged('review:revB:impl:1')
    })
    expect(setStatus).toHaveBeenCalledWith('origin', 'approved')
  })

  it('stopping both reviewers in the same tick clears the origin', async () => {
    const { result, setStatus } = setup({ state: mkDualState() })
    await act(async () => {})
    await act(async () => {
      result.current.stopLoop('revA')
      result.current.stopLoop('revB')
    })
    const originCalls = setStatus.mock.calls.filter((c) => c[0] === 'origin')
    expect(originCalls.at(-1)).toEqual(['origin', undefined])
  })
```

(The existing single-reviewer test `processes a verdict that landed while the renderer was away` already pins the complement: sole reviewer approves → origin `approved`.)

- [ ] **Step 8.2: Run to verify they fail**

Run: `npx vitest run src/renderer/src/review/useReview.test.tsx`
Expected: FAIL — origin gets `approved`/`undefined` despite revB.

- [ ] **Step 8.3: Implement**

Add a ref next to `watching`/`awaiting` (after line 37):

```ts
  // Reviewers finalized/stopped this tick — `state` lags one render behind
  // apply(), so a second verdict in the same tick would still "see" the first
  // reviewer and miss the last-one-out transition. Terminal ids are UUIDs and
  // never recycled, so the set needs no cleanup.
  const removed = useRef(new Set<string>())
```

Replace `finalizeApproved` (lines 61-69):

```ts
  // A reviewer approved: remove its terminal — App's PTY reaper kills its PTY —
  // and clean up its watches and any queued critique. The origin goes green
  // only when the LAST reviewer leaves: ALL must approve (intent decision).
  const finalizeApproved = useCallback((reviewerId: string, originId: string) => {
    for (const [watchId, w] of [...watching.current]) {
      if (w.reviewerId === reviewerId) { window.brain.unwatchFile(watchId); watching.current.delete(watchId) }
    }
    const cycle = awaiting.current.get(originId)
    if (cycle) {
      cycle.applied = cycle.applied.filter((rid) => rid !== reviewerId)
      cycle.queue = cycle.queue.filter((q) => q.reviewerId !== reviewerId)
    }
    apply((s) => removeTerminal(s, reviewerId))
    setStatus(reviewerId, undefined)
    removed.current.add(reviewerId)
    const others = findReviewersFor(state, originId)
      .filter((r) => r.id !== reviewerId && !removed.current.has(r.id))
    if (others.length === 0) {
      awaiting.current.delete(originId)
      setStatus(originId, 'approved')
    }
  }, [state, apply, setStatus])
```

Replace `stopLoop` (lines 226-237):

```ts
  // 5. Stop ONE reviewer's loop (manual escape): remove it; clear the origin
  // (no green) only when it was the last reviewer.
  const stopLoop = useCallback((reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    for (const [watchId, w] of [...watching.current]) {
      if (w.reviewerId === reviewer.id) { window.brain.unwatchFile(watchId); watching.current.delete(watchId) }
    }
    const originId = link.originTerminalId
    const cycle = awaiting.current.get(originId)
    if (cycle) {
      cycle.applied = cycle.applied.filter((rid) => rid !== reviewerId)
      cycle.queue = cycle.queue.filter((q) => q.reviewerId !== reviewerId)
    }
    apply((s) => removeTerminal(s, reviewer.id))
    setStatus(reviewer.id, undefined)
    removed.current.add(reviewerId)
    const others = findReviewersFor(state, originId)
      .filter((r) => r.id !== reviewerId && !removed.current.has(r.id))
    if (others.length === 0) {
      awaiting.current.delete(originId)
      setStatus(originId, undefined)
    }
  }, [state, apply, setStatus])
```

The store import in useReview.ts already says `findReviewersFor` (Task 7). Delete `findReviewerFor` from `store.ts`. In `store.test.ts`: delete the `findReviewerFor` test (~lines 472-481), switch any other usage (the `patchReviewLink` test ~line 489 reads `findReviewerFor(s, 'o')?.review` → `findReviewersFor(s, 'o')[0]?.review`), and fix the import on line 8.

- [ ] **Step 8.4: Run, verify PASS, commit**

```bash
npx vitest run src/renderer/src/review/ src/renderer/src/store.test.ts && npm run typecheck
git add src/renderer/src/review/useReview.ts src/renderer/src/review/useReview.test.tsx src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(review): origin approves only when the LAST reviewer leaves"
```

### Task 9: `FeatureHeader` — one control cluster per reviewer

**Files:**
- Modify: `src/renderer/src/components/FeatureHeader.tsx:5-9, 21-44, 77-87`
- Test: `src/renderer/src/components/FeatureHeader.test.tsx`

- [ ] **Step 9.1: Update the tests**

In `FeatureHeader.test.tsx` replace `const noReview = ...` and every `review={...}` usage:

```tsx
const base = {
  featureName: 'auth', viewMode: 'tabs' as const, onToggleView: vi.fn(), onAdd: vi.fn(),
  onMoreRounds: vi.fn(), onAcceptPhase: vi.fn(), onStopLoop: vi.fn(),
  gridStyle: 'auto' as const, onSetGridStyle: vi.fn()
}
```

- every `review={noReview}` → `reviews={[]}`
- line 28: `review={{ reviewerId: 'b', needsDecision: true, active: false }}` → `reviews={[{ reviewerId: 'b', kind: 'codex' as const, needsDecision: true, active: false }]}`
- line 66: `review={{ ...noReview, reviewerId: 'b', active: true }}` → `reviews={[{ reviewerId: 'b', kind: 'codex' as const, needsDecision: false, active: true }]}`
- line 74: `review={{ ...noReview, reviewerId: 'b', needsDecision: true }}` → `reviews={[{ reviewerId: 'b', kind: 'codex' as const, needsDecision: true, active: false }]}`

Add the dual test:

```tsx
  it('renders one control cluster per reviewer and routes clicks by reviewer id', () => {
    const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onStopLoop={onStopLoop} reviews={[
      { reviewerId: 'a', kind: 'claude', needsDecision: false, active: true },
      { reviewerId: 'b', kind: 'codex', needsDecision: false, active: true }
    ]} />)
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.getByText('codex')).toBeInTheDocument()
    const stops = screen.getAllByRole('button', { name: 'Stop loop' })
    expect(stops).toHaveLength(2)
    fireEvent.click(stops[1])
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })
```

- [ ] **Step 9.2: Run to verify failure, then implement**

Replace `ReviewControl` and the component's review rendering:

```tsx
export interface ReviewControl {
  reviewerId: string
  kind: 'claude' | 'codex'
  needsDecision: boolean // maxRounds reached
  active: boolean        // loop running (reviewing or applying)
}
```

Props: `review: ReviewControl` → `reviews: ReviewControl[]`. In the body:

```tsx
  const visible = reviews.filter((r) => r.needsDecision || r.active)
  const showControls = visible.length > 0
```

and replace the two `{rid && ...}` blocks (lines 78-87) with:

```tsx
        {visible.map((r) => (
          <span key={r.reviewerId} className="flex items-center gap-1.5">
            {visible.length > 1 && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{r.kind}</span>
            )}
            {r.needsDecision ? (
              <>
                <button onClick={() => onMoreRounds(r.reviewerId)} title="Run more review rounds" className={goBtn}>Continue</button>
                <button onClick={() => onAcceptPhase(r.reviewerId)} title="Accept as approved (reviewer closes)" className={ghostBtn}>Accept</button>
                <button onClick={() => onStopLoop(r.reviewerId)} title="Stop the review loop" className={stopBtn}>Stop loop</button>
              </>
            ) : (
              <button onClick={() => onStopLoop(r.reviewerId)} title="Stop the review loop" className={stopBtn}>Stop loop</button>
            )}
          </span>
        ))}
```

Delete the old `const rid = review.reviewerId` line. (App.tsx still passes `review=` — it breaks typecheck until Task 11; run only the component test here and commit Tasks 9-11 together if preferred, or accept the red typecheck between commits. Preferred: commit 9+10+11 as one unit at the end of Task 11.)

- [ ] **Step 9.3: Run the component test**

Run: `npx vitest run src/renderer/src/components/FeatureHeader.test.tsx`
Expected: PASS.

### Task 10: `ReviewDialog` — multi-select reviewers, disable active kinds

**Files:**
- Modify: `src/renderer/src/components/ReviewDialog.tsx:7-13, 15-28, 49-55, 69-75`
- Test: `src/renderer/src/components/ReviewDialog.test.tsx`

- [ ] **Step 10.1: Update the tests**

`baseProps` gains `activeKinds: [] as ('claude' | 'codex')[]`. Every `onStart` payload assertion changes `reviewer: 'codex'` → `reviewers: ['codex']`. Add:

```tsx
  it('selects multiple reviewers and passes them all on start', () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Intent'))
    fireEvent.click(screen.getByRole('button', { name: 'Claude' })) // codex (default) + claude
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ reviewers: ['codex', 'claude'] }))
  })

  it('disables a kind that is already reviewing this origin and blocks empty selection', () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} activeKinds={['codex']} onStart={onStart} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Codex' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Start review' })) // nothing selected
    expect(onStart).not.toHaveBeenCalled()
  })
```

- [ ] **Step 10.2: Run to verify failure, then implement**

```tsx
export interface ReviewStartArgs {
  reviewers: AgentKind[]
  phase: ReviewPhase
  maxRounds: number
  specPath?: string
  intent: string
}
```

Component changes:

```tsx
export function ReviewDialog({
  originName, defaultReviewer, activeKinds, cwd, onStart, onCancel
}: {
  originName: string
  defaultReviewer: AgentKind
  activeKinds: AgentKind[]   // kinds already reviewing this origin — locked out
  cwd: string
  onStart: (args: ReviewStartArgs) => void
  onCancel: () => void
}) {
  const [reviewers, setReviewers] = useState<AgentKind[]>(
    () => (activeKinds.includes(defaultReviewer) ? [] : [defaultReviewer])
  )
```

Toggle handler + buttons (replace the reviewer segment, lines 69-75):

```tsx
  const toggleReviewer = (k: AgentKind) =>
    setReviewers((rs) => (rs.includes(k) ? rs.filter((x) => x !== k) : [...rs, k]))
```

```tsx
        <div className="mb-3">
          <span className="text-sm text-fg">Reviewer</span>
          <div className="mt-1 flex gap-2">
            {(['claude', 'codex'] as AgentKind[]).map((k) => (
              <button key={k} type="button" disabled={activeKinds.includes(k)}
                title={activeKinds.includes(k) ? `${k} is already reviewing this terminal` : undefined}
                className={`${seg(reviewers.includes(k))} disabled:opacity-40 disabled:cursor-not-allowed`}
                onClick={() => toggleReviewer(k)}>
                {k === 'claude' ? 'Claude' : 'Codex'}
              </button>
            ))}
          </div>
        </div>
```

Submit guard:

```tsx
  const submit = () => {
    if (reviewers.length === 0) return
    onStart({
      reviewers, phase, maxRounds: Math.max(1, parseInt(maxRounds, 10) || 1),
      specPath: phase === 'intent' ? undefined : (specPath.trim() || undefined),
      intent: intent.trim()
    })
  }
```

- [ ] **Step 10.3: Run the dialog tests**

Run: `npx vitest run src/renderer/src/components/ReviewDialog.test.tsx`
Expected: PASS.

### Task 11: App wiring + duplicate-kind guard in `startReview`

**Files:**
- Modify: `src/renderer/src/App.tsx:255-270, 534, 662-672`
- Modify: `src/renderer/src/review/useReview.ts:72-75` (guard)
- Test: `src/renderer/src/review/useReview.test.tsx` (guard test)

- [ ] **Step 11.1: Write the failing guard test**

In the `useReview parallel reviewers` describe:

```ts
  it('refuses a second reviewer of the same kind on one origin', async () => {
    const { result, apply } = setup({ state: mkDualState() }) // both kinds already reviewing this origin
    await act(async () => {})
    apply.mockClear()
    await act(() => result.current.startReview({ originTerminalId: 'origin', reviewer: 'codex', phase: 'impl', maxRounds: 3 }))
    expect(apply).not.toHaveBeenCalled() // no terminal added
  })
```

- [ ] **Step 11.2: Implement the guard**

In `useReview.startReview`, after the `featureId` check (line 74):

```ts
    // One reviewer per agent kind per origin (intent decision) — the dialog
    // disables duplicates, but guard here too for non-dialog callers.
    if (findReviewersFor(state, a.originTerminalId).some((t) => t.kind === a.reviewer)) return
```

- [ ] **Step 11.3: Wire App.tsx**

Replace lines 255-264:

```tsx
  // The pipeline controls live on the feature's reviewer terminals (the ones
  // with a review link); origin and reviewers share the feature.
  const featureReviewers = activeFeature?.terminals.filter((t) => !!t.review) ?? []
  const reviewControls = featureReviewers.map((r) => ({
    reviewerId: r.id,
    kind: (r.kind === 'codex' ? 'codex' : 'claude') as 'claude' | 'codex',
    needsDecision: reviewStatus[r.id] === 'needs-decision',
    active: reviewStatus[r.id] === 'reviewing' ||
      (r.review ? reviewStatus[r.review.originTerminalId] === 'applying' : false)
  }))
```

Line 534: `review={reviewControl}` → `reviews={reviewControls}`.

Replace the `startReview` handler (lines 265-270):

```tsx
  const startReview = (args: ReviewStartArgs) => {
    if (!reviewReq) return
    markStarted(reviewReq.id) // the loop relays into the origin's PTY — it must be running
    const { reviewers, ...rest } = args
    for (const reviewer of reviewers) void review.startReview({ originTerminalId: reviewReq.id, reviewer, ...rest })
    setReviewReq(null)
  }
```

In the dialog render (~line 662-672) pass the active kinds (import `findReviewersFor` from `./store`):

```tsx
            activeKinds={findReviewersFor(state, reviewReq.id).map((r) => (r.kind === 'codex' ? 'codex' : 'claude') as 'claude' | 'codex')}
```

- [ ] **Step 11.4: Full verification and the combined commit for Tasks 9-11**

Run: `npm test && npm run typecheck`
Expected: ALL tests pass, no type errors.

```bash
git add src/renderer/src/components/FeatureHeader.tsx src/renderer/src/components/FeatureHeader.test.tsx src/renderer/src/components/ReviewDialog.tsx src/renderer/src/components/ReviewDialog.test.tsx src/renderer/src/App.tsx src/renderer/src/review/useReview.ts src/renderer/src/review/useReview.test.tsx
git commit -m "feat(review): dual-reviewer UI — multi-select dialog, per-reviewer controls"
```

### Task 12: Final verification + manual smoke

- [ ] **Step 12.1: Full suite**

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 12.2: Manual smoke (success criteria from the intent)**

Launch `npm run dev`, then:
1. Start a review on an agent terminal selecting BOTH Claude and Codex → two reviewer terminals appear, named `claude review: …` / `codex review: …`; on disk `~/.config/brain/reviews/<originId>/claude/` and `.../codex/` each get their own `review-<phase>-1.md`.
2. Both write NEEDS-WORK → relays land in the origin one after the other; after the origin settles, BOTH reviewers get round 2.
3. One approves → its terminal closes, origin stays `under-review` (no green dot) until the second approves.
4. Reload the window mid-review (Ctrl+R) → both loops resume.
5. Single-reviewer flow unchanged (start with only one kind selected).

- [ ] **Step 12.3: Use superpowers:finishing-a-development-branch**

Merge target per user's workflow: feature branch → `--no-ff` merge; **confirm with the user before pushing**.

---

## Self-review notes

- Intent coverage: subfolder per agent (T2-T3), back-compat reviewDir re-point (T4), distinguishable names (T5), advance-all + relay queue (T7), ALL-must-approve aggregation (T8), per-reviewer controls (T9), multi-select + duplicate-kind lockout (T10-T11), success criteria → smoke steps (T12.2).
- Pre-existing tests intentionally changed: `resolveReviewDir` mock arity + assertion (T3), reviewer naming (T5), `findReviewerFor` removal (T8), FeatureHeader/ReviewDialog props (T9-T10). Every change is listed with its exact replacement.
- Known naming caveat in T6: the store test's state-helper names must be copied from the neighbouring `findReviewerFor` test at execution time; the assertions are normative, the setup identifiers are not.
- Spec-review round 1 (`review-spec-1.md`) incorporated: same-tick finalize race fixed with the `removed`-set ref in `finalizeApproved`/`stopLoop` + two same-tick tests (T8); origin badge preserved while a non-cycle reviewer is still reviewing, via an armed-watch check + test (T7); conditional origin status in `requestReview` (non-blocking note 1); reload cycle-reconstruction test (note 2); guard-test comment (note 3); import instructions aligned (findReviewersFor enters in T7). Deliberate deviation from the reviewer's Blocker-2 proposal: the still-reviewing check reads `watching.current` instead of `statusRef` — the status prop round-trips through App's render and lags exactly like Blocker 1's `state`, while the watch map updates synchronously in the hook; an armed verdict watch is the operational definition of "still reviewing".

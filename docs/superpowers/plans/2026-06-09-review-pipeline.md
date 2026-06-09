# Review Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-artifact, manual review with a gated `intent → spec → impl` pipeline where each phase auto-loops (reviewer judges `APPROVED`/`NEEDS-WORK`, capped by `maxRounds`), the reviewer reads the origin agent's session transcript, and one reviewer terminal stays bound to its origin across all phases and rounds.

**Architecture:** All decision logic lives in pure, unit-tested modules (`verdict`, `phases`, `prompt`, `transcript`); the React hook `useReview` is thin glue that wires those decisions to IPC (PTY writes, file watch, file read, busy/idle). The reviewer's `APPROVED`/`NEEDS-WORK` verdict is parsed from the first line of its critique file; "origin finished applying" is detected from the existing `pty:busy` (busyTracker) idle transition. Status is transient React state keyed by terminal id; the `ReviewLink` (persisted on the reviewer terminal) tracks `phase`/`round`/`maxRounds`/artifact paths.

**Tech Stack:** Electron + React 18 + TypeScript, Vitest (`vitest run`) with @testing-library/react + jsdom, Tailwind. Path alias `@shared` → `src/shared`.

---

## Spec reference

`docs/superpowers/specs/2026-06-09-review-pipeline-design.md`

## File Structure

**New files**
- `src/renderer/src/review/verdict.ts` — `parseVerdict(text)` → `'approved' | 'needs-work'`. Pure.
- `src/renderer/src/review/phases.ts` — phase order, `nextPhase`, `afterApply`, labels. Pure.
- `src/main/transcript.ts` — discover the origin agent's session JSONL from cwd/kind. fs + pure path encoder.
- Test files mirroring each of the above.

**Modified files**
- `src/shared/types.ts` — `ReviewKind`→`ReviewPhase`; new `ReviewLink`; new `ReviewStatus` union.
- `src/shared/ipc.ts` — add `reviewResolveTranscript`, `fsRead` channels.
- `src/shared/api.ts` — `resolveReviewDir` gains `phase` + richer return; add `resolveTranscript`, `readTextFile`.
- `src/preload/index.ts` — wire the three changed/new channels.
- `src/main/ipc.ts` — phase-aware `resolveReviewDir`; handlers for transcript + file read.
- `src/main/reviewFs.ts` — phase-named review files + return `intentPath`/`specPath`.
- `src/renderer/src/store.ts` — replace `setReviewRound` with generic `patchReviewLink`.
- `src/renderer/src/migrate.ts` — drop legacy (`reviewKind`-shaped) review links on load.
- `src/renderer/src/review/prompt.ts` — per-phase prompts + VERDICT contract; startup vs inject forms.
- `src/renderer/src/review/status.ts` — map new statuses; add `'active'` dot.
- `src/renderer/src/components/ReviewStatusDot.tsx` — render the `'active'` dot.
- `src/renderer/src/review/useReview.ts` — full rewrite: the auto state machine.
- `src/renderer/src/components/ReviewDialog.tsx` — choose start phase + maxRounds.
- `src/renderer/src/components/FeatureHeader.tsx` — review-control buttons (gate / decision / stop).
- `src/renderer/src/App.tsx` — wire busy→loop, derive controls + origin indicator, new dialog args.

Build order is bottom-up: pure modules → main/IPC → store/migrate → glue (`useReview`) → UI → App wiring → full verify.

---

## Task 1: Types — phases, link shape, statuses

**Files:**
- Modify: `src/shared/types.ts:3-13`

- [ ] **Step 1: Replace the review types**

In `src/shared/types.ts`, replace lines 3-13 (`ReviewKind`, `ReviewLink`, `ReviewStatus`) with:

```ts
export type ReviewPhase = 'intent' | 'spec' | 'impl'

export interface ReviewLink {
  originTerminalId: string   // A — the implementer this terminal reviews
  phase: ReviewPhase         // where we are in the pipeline
  round: number              // 1-based round WITHIN the current phase
  maxRounds: number          // safety cap before stopping for a decision
  reviewDir: string          // absolute dir for review-<phase>-<round>.md (outside the project)
  transcriptPath?: string    // origin agent's session JSONL (intent phase)
  intentPath?: string        // artifact built in the intent phase
  specPath?: string          // artifact for the spec phase
}

export type ReviewStatus =
  | 'reviewing'        // B is writing its critique
  | 'applying'         // A is applying the feedback
  | 'under-review'     // A: loop active, awaiting/working — the origin indicator
  | 'phase-approved'   // B: phase APPROVED, waiting at the user gate
  | 'needs-decision'   // B: maxRounds reached, waiting for the user
```

- [ ] **Step 2: Typecheck (expect failures elsewhere — that's fine for now)**

Run: `npm run typecheck`
Expected: errors ONLY in files that still reference `ReviewKind`/old statuses (`review/prompt.ts`, `review/status.ts`, `review/useReview.ts`, `components/ReviewDialog.tsx`, `App.tsx`, `store.ts`). No errors inside `types.ts` itself. These get fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(review): phase/link/status types for the review pipeline"
```

---

## Task 2: `verdict.ts` — parse the reviewer's verdict

**Files:**
- Create: `src/renderer/src/review/verdict.ts`
- Test: `src/renderer/src/review/verdict.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/review/verdict.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseVerdict } from './verdict'

describe('parseVerdict', () => {
  it('reads APPROVED from the first line', () => {
    expect(parseVerdict('VERDICT: APPROVED\nlooks good')).toBe('approved')
  })
  it('reads NEEDS-WORK from the first line', () => {
    expect(parseVerdict('VERDICT: NEEDS-WORK\n- fix x')).toBe('needs-work')
  })
  it('is case-insensitive and ignores leading blank lines', () => {
    expect(parseVerdict('\n\n  verdict: approved  \n')).toBe('approved')
  })
  it('treats trailing prose after APPROVED as approved', () => {
    expect(parseVerdict('VERDICT: APPROVED — minor nits only')).toBe('approved')
  })
  it('defaults to needs-work when the verdict line is missing', () => {
    expect(parseVerdict('I think this is mostly fine')).toBe('needs-work')
  })
  it('defaults to needs-work on empty input', () => {
    expect(parseVerdict('')).toBe('needs-work')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/review/verdict.test.ts`
Expected: FAIL — `parseVerdict` is not defined.

- [ ] **Step 3: Implement**

Create `src/renderer/src/review/verdict.ts`:

```ts
export type Verdict = 'approved' | 'needs-work'

// The reviewer is instructed to put `VERDICT: APPROVED|NEEDS-WORK` on the first
// non-empty line. Anything else (missing/garbled) falls back to needs-work, the
// safe branch — a misformatted verdict never silently ends the loop.
export function parseVerdict(fileText: string): Verdict {
  const firstLine = fileText.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const m = firstLine.toUpperCase().match(/VERDICT:\s*(APPROVED|NEEDS-WORK)/)
  return m && m[1] === 'APPROVED' ? 'approved' : 'needs-work'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/review/verdict.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/review/verdict.ts src/renderer/src/review/verdict.test.ts
git commit -m "feat(review): parseVerdict reads APPROVED/NEEDS-WORK from critique file"
```

---

## Task 3: `phases.ts` — pipeline order + loop decisions

**Files:**
- Create: `src/renderer/src/review/phases.ts`
- Test: `src/renderer/src/review/phases.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/review/phases.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PHASE_ORDER, PHASE_LABEL, nextPhase, afterApply } from './phases'

describe('phases', () => {
  it('orders intent → spec → impl', () => {
    expect(PHASE_ORDER).toEqual(['intent', 'spec', 'impl'])
  })
  it('nextPhase walks the pipeline and ends at null', () => {
    expect(nextPhase('intent')).toBe('spec')
    expect(nextPhase('spec')).toBe('impl')
    expect(nextPhase('impl')).toBeNull()
  })
  it('has a human label per phase', () => {
    expect(PHASE_LABEL.intent).toBe('Intent')
    expect(PHASE_LABEL.spec).toBe('Spec/plan')
    expect(PHASE_LABEL.impl).toBe('Implementation')
  })
  it('afterApply iterates while under the cap', () => {
    expect(afterApply(1, 5)).toEqual({ type: 'iterate', round: 2 })
  })
  it('afterApply stops once the next round would exceed the cap', () => {
    expect(afterApply(5, 5)).toEqual({ type: 'stop' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/review/phases.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/renderer/src/review/phases.ts`:

```ts
import type { ReviewPhase } from '@shared/types'

export const PHASE_ORDER: ReviewPhase[] = ['intent', 'spec', 'impl']

export const PHASE_LABEL: Record<ReviewPhase, string> = {
  intent: 'Intent',
  spec: 'Spec/plan',
  impl: 'Implementation'
}

// The next phase in the pipeline, or null when `p` is the last one.
export function nextPhase(p: ReviewPhase): ReviewPhase | null {
  const i = PHASE_ORDER.indexOf(p)
  return i >= 0 && i < PHASE_ORDER.length - 1 ? PHASE_ORDER[i + 1] : null
}

// After the origin applies a NEEDS-WORK critique: iterate (bump round) unless the
// next round would exceed the cap, in which case stop for a user decision.
export function afterApply(round: number, maxRounds: number):
  | { type: 'iterate'; round: number }
  | { type: 'stop' } {
  return round + 1 > maxRounds ? { type: 'stop' } : { type: 'iterate', round: round + 1 }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/review/phases.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/review/phases.ts src/renderer/src/review/phases.test.ts
git commit -m "feat(review): phase order + nextPhase/afterApply loop decisions"
```

---

## Task 4: `prompt.ts` — per-phase prompts with VERDICT contract

**Files:**
- Modify: `src/renderer/src/review/prompt.ts` (full rewrite below)
- Test: `src/renderer/src/review/prompt.test.ts` (full rewrite below)

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `src/renderer/src/review/prompt.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import {
  shellSingleQuote, buildReviewerCommand,
  reviewerStartupPrompt, reviewerInjectPrompt, relayToOriginPrompt
} from './prompt'

describe('shellSingleQuote', () => {
  it('wraps in single quotes', () => expect(shellSingleQuote('abc')).toBe(`'abc'`))
  it('escapes embedded single quotes', () => expect(shellSingleQuote("a'b")).toBe(`'a'\\''b'`))
})

describe('buildReviewerCommand', () => {
  it('joins agent command with quoted prompt', () =>
    expect(buildReviewerCommand('claude', 'hi')).toBe(`claude 'hi'`))
})

describe('reviewerStartupPrompt', () => {
  it('intent: references the transcript + review file + VERDICT contract', () => {
    const p = reviewerStartupPrompt({ phase: 'intent', round: 1, reviewFile: '/r/review-intent-1.md', transcriptPath: '/t/s.jsonl' })
    expect(p).toContain('/t/s.jsonl')
    expect(p).toContain('/r/review-intent-1.md')
    expect(p).toContain('VERDICT: APPROVED')
    expect(p).toContain('VERDICT: NEEDS-WORK')
  })
  it('spec: references the spec path and the intent path', () => {
    const p = reviewerStartupPrompt({ phase: 'spec', round: 1, reviewFile: '/r/review-spec-1.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p).toContain('/a/spec.md')
    expect(p).toContain('/r/intent.md')
  })
  it('impl: references git diff, intent and spec', () => {
    const p = reviewerStartupPrompt({ phase: 'impl', round: 1, reviewFile: '/r/review-impl-1.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p).toContain('git diff')
    expect(p).toContain('/a/spec.md')
    expect(p).toContain('/r/intent.md')
  })
  it('round > 1 adds a re-review preamble', () => {
    const p = reviewerStartupPrompt({ phase: 'spec', round: 2, reviewFile: '/r/review-spec-2.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p.toLowerCase()).toContain('revised')
  })
})

describe('reviewerInjectPrompt', () => {
  it('is a single line (safe to write into an agent PTY)', () => {
    const p = reviewerInjectPrompt({ phase: 'spec', round: 2, reviewFile: '/r/review-spec-2.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p).not.toContain('\n')
    expect(p).toContain('/r/review-spec-2.md')
  })
})

describe('relayToOriginPrompt', () => {
  it('intent: points at the critique and the intent document, single line', () => {
    const p = relayToOriginPrompt({ phase: 'intent', reviewFile: '/r/review-intent-1.md', intentPath: '/r/intent.md' })
    expect(p).toContain('/r/review-intent-1.md')
    expect(p).toContain('/r/intent.md')
    expect(p).not.toContain('\n')
  })
  it('spec: points at the spec path, single line', () => {
    const p = relayToOriginPrompt({ phase: 'spec', reviewFile: '/r/review-spec-1.md', specPath: '/a/spec.md' })
    expect(p).toContain('/a/spec.md')
    expect(p).not.toContain('\n')
  })
  it('impl: mentions not to commit, single line', () => {
    const p = relayToOriginPrompt({ phase: 'impl', reviewFile: '/r/review-impl-1.md' })
    expect(p).toContain('commit')
    expect(p).not.toContain('\n')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/review/prompt.test.ts`
Expected: FAIL — `reviewerStartupPrompt`/`reviewerInjectPrompt` not exported; old `reviewerPrompt` signature gone.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `src/renderer/src/review/prompt.ts` with:

```ts
import type { ReviewPhase } from '@shared/types'

/** POSIX single-quote escaping for embedding a prompt as one shell argument. */
export function shellSingleQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

/** `<agent> '<prompt>'` — launches the agent with the prompt as its first message. */
export function buildReviewerCommand(agentCommand: string, prompt: string): string {
  return `${agentCommand} ${shellSingleQuote(prompt)}`
}

export interface ReviewerPromptArgs {
  phase: ReviewPhase
  round: number
  reviewFile: string
  transcriptPath?: string
  intentPath?: string
  specPath?: string
  intent?: string
}

const VERDICT_CONTRACT =
  'On the FIRST line of the file write EXACTLY one of: `VERDICT: APPROVED` or `VERDICT: NEEDS-WORK` ' +
  '— use APPROVED only when you have no blocking concerns — then write the critique below.'

function bodyLines(a: ReviewerPromptArgs): string[] {
  const intent = a.intent?.trim()
  if (a.phase === 'intent') {
    return [
      'You are a reviewer — a second AI agent. Do NOT modify any files; only WRITE your critique to the review file.',
      `Read the author's conversation transcript (JSONL, one message per line) at: ${a.transcriptPath ?? '(transcript unavailable — judge from the intent note below)'}.`,
      intent ? `The author summarized the goal as: ${intent}.` : "Infer the author's goal from the transcript.",
      'Judge whether the INTENT is clear and complete: problem, goals, constraints, success criteria. Flag gaps, ambiguities, and contradictions.'
    ]
  }
  if (a.phase === 'spec') {
    return [
      'You are a reviewer — a second AI agent. Do NOT modify the spec; only WRITE your critique to the review file.',
      `Review the spec/plan at: ${a.specPath}. The agreed intent is at: ${a.intentPath}.`,
      'Judge: does the spec fully cover the intent? Correctness, gaps, contradictions, scope (YAGNI), feasibility. Be concrete; propose exact changes.'
    ]
  }
  return [
    'You are a reviewer — a second AI agent. Do NOT commit; only WRITE your critique to the review file.',
    'Run `git status` and `git diff` and review the uncommitted changes in this repository.',
    `The intent is at: ${a.intentPath}; the spec is at: ${a.specPath}.`,
    'Judge: does the implementation follow the spec? Bugs, edge cases, correctness, simplicity.'
  ]
}

export function reviewerPromptLines(a: ReviewerPromptArgs): string[] {
  const preamble = a.round > 1
    ? ['The author has revised in response to your previous critique — re-review from scratch.']
    : []
  return [...preamble, ...bodyLines(a), VERDICT_CONTRACT, `WRITE your critique to (create or overwrite): ${a.reviewFile}.`]
}

/** Multi-line form — used as the reviewer terminal's startupCommand (first spawn). */
export const reviewerStartupPrompt = (a: ReviewerPromptArgs): string => reviewerPromptLines(a).join('\n')

/** Single-line form — written into the existing reviewer PTY for later rounds/phases
 *  (newlines would submit prematurely in an agent TUI). */
export const reviewerInjectPrompt = (a: ReviewerPromptArgs): string => reviewerPromptLines(a).join(' ')

export interface RelayPromptArgs {
  phase: ReviewPhase
  reviewFile: string
  intentPath?: string
  specPath?: string
}

/** Single-line prompt injected into the origin (A) telling it to apply the critique. */
export function relayToOriginPrompt(a: RelayPromptArgs): string {
  if (a.phase === 'intent') {
    return `The reviewer left a critique in ${a.reviewFile}. Update the intent document ${a.intentPath} (create it if missing) where you agree; where you disagree, briefly explain why. Do not start the spec or code yet.`
  }
  if (a.phase === 'spec') {
    return `The reviewer left a critique in ${a.reviewFile}. Update ${a.specPath} where you agree; where you disagree, briefly explain. Do not implement yet.`
  }
  return `The reviewer left a critique in ${a.reviewFile}. Apply the fixes in the code where you agree; where you disagree, briefly explain. Do not commit.`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/review/prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/review/prompt.ts src/renderer/src/review/prompt.test.ts
git commit -m "feat(review): per-phase reviewer/relay prompts with VERDICT contract"
```

---

## Task 5: `status.ts` + `ReviewStatusDot` — new status → dot mapping

**Files:**
- Modify: `src/renderer/src/review/status.ts`
- Modify: `src/renderer/src/components/ReviewStatusDot.tsx:5-10`
- Test: `src/renderer/src/review/status.test.ts` (rewrite)

- [ ] **Step 1: Rewrite the status test**

Replace the entire contents of `src/renderer/src/review/status.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { statusDot } from './status'

describe('statusDot', () => {
  it('reviewing/applying → spinner', () => {
    expect(statusDot('reviewing')).toBe('spinner')
    expect(statusDot('applying')).toBe('spinner')
  })
  it('phase-approved/needs-decision → attention', () => {
    expect(statusDot('phase-approved')).toBe('attention')
    expect(statusDot('needs-decision')).toBe('attention')
  })
  it('under-review → active', () => {
    expect(statusDot('under-review')).toBe('active')
  })
  it('undefined → null', () => {
    expect(statusDot(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/review/status.test.ts`
Expected: FAIL — old mapping returns wrong values for the new statuses.

- [ ] **Step 3: Update `status.ts`**

Replace the entire contents of `src/renderer/src/review/status.ts` with:

```ts
import type { ReviewStatus } from '@shared/types'

export type DotKind = 'spinner' | 'attention' | 'active' | null

export function statusDot(status: ReviewStatus | undefined): DotKind {
  if (status === 'reviewing' || status === 'applying') return 'spinner'
  if (status === 'phase-approved' || status === 'needs-decision') return 'attention'
  if (status === 'under-review') return 'active'
  return null
}
```

- [ ] **Step 4: Update `ReviewStatusDot.tsx`**

Replace lines 5-10 (the function body) of `src/renderer/src/components/ReviewStatusDot.tsx` with:

```tsx
export function ReviewStatusDot({ status }: { status: ReviewStatus | undefined }) {
  const dot = statusDot(status)
  if (dot === null) return null
  if (dot === 'spinner') return <SpinnerIcon className="shrink-0 text-accent" />
  if (dot === 'active') return <span data-testid="review-active" title="Pod review-om" className="shrink-0 h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]" />
  return <span data-testid="review-attention" title="Pogledaj rezultat" className="shrink-0 h-2 w-2 rounded-full bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.7)]" />
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/renderer/src/review/status.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/review/status.ts src/renderer/src/review/status.test.ts src/renderer/src/components/ReviewStatusDot.tsx
git commit -m "feat(review): map new statuses; add under-review 'active' dot"
```

---

## Task 6: `reviewFs.ts` — phase-named review files + artifact paths

**Files:**
- Modify: `src/main/reviewFs.ts:42-52`
- Test: `src/main/reviewFs.test.ts` (update two `describe` blocks)

- [ ] **Step 1: Update the reviewFs tests**

In `src/main/reviewFs.test.ts`, replace the `describe('reviewDirFor / reviewFilePath', ...)` block (lines 20-27) with:

```ts
describe('reviewDirFor / reviewFilePath', () => {
  it('keys the dir by origin id under reviews/', () => {
    expect(reviewDirFor('/data', 'abc')).toBe(join('/data', 'reviews', 'abc'))
  })
  it('names review files review-<phase>-<round>.md', () => {
    expect(reviewFilePath('/data/reviews/abc', 'spec', 2)).toBe(join('/data/reviews/abc', 'review-spec-2.md'))
  })
})
```

And replace the `describe('resolveReviewPaths', ...)` block (lines 58-68) with:

```ts
describe('resolveReviewPaths', () => {
  it('mkdir -p the review dir and returns review/intent/spec paths', async () => {
    const base = await mktmp()
    const { reviewDir, reviewFile, intentPath, specPath } = await resolveReviewPaths(base, 'tid', 'intent', 1)
    expect(reviewDir).toBe(join(base, 'reviews', 'tid'))
    expect(reviewFile).toBe(join(base, 'reviews', 'tid', 'review-intent-1.md'))
    expect(intentPath).toBe(join(base, 'reviews', 'tid', 'intent.md'))
    expect(specPath).toBe(join(base, 'reviews', 'tid', 'spec.md'))
    const stat = await fs.stat(reviewDir)
    expect(stat.isDirectory()).toBe(true)
    await fs.rm(base, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/reviewFs.test.ts`
Expected: FAIL — `reviewFilePath`/`resolveReviewPaths` arity mismatch.

- [ ] **Step 3: Update `reviewFs.ts`**

In `src/main/reviewFs.ts`, add this import at the top (after line 2):

```ts
import type { ReviewPhase } from '@shared/types'
```

Then replace lines 42-52 (`reviewFilePath` + `resolveReviewPaths`) with:

```ts
export function reviewFilePath(reviewDir: string, phase: ReviewPhase, round: number): string {
  return join(reviewDir, `review-${phase}-${round}.md`)
}

export async function resolveReviewPaths(
  userDataDir: string, originTerminalId: string, phase: ReviewPhase, round: number
): Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }> {
  const reviewDir = reviewDirFor(userDataDir, originTerminalId)
  await fs.mkdir(reviewDir, { recursive: true })
  return {
    reviewDir,
    reviewFile: reviewFilePath(reviewDir, phase, round),
    intentPath: join(reviewDir, 'intent.md'),
    specPath: join(reviewDir, 'spec.md')
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/reviewFs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/reviewFs.ts src/main/reviewFs.test.ts
git commit -m "feat(review): phase-named review files + intent/spec artifact paths"
```

---

## Task 7: `transcript.ts` — discover the origin agent's session JSONL

**Files:**
- Create: `src/main/transcript.ts`
- Test: `src/main/transcript.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/transcript.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { claudeProjectDir, newestJsonl, resolveTranscript } from './transcript'

const mktmp = async () => {
  const dir = join(tmpdir(), `ttor-tr-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

describe('claudeProjectDir', () => {
  it('encodes cwd by replacing slashes with dashes under ~/.claude/projects', () => {
    expect(claudeProjectDir('/home/me', '/home/me/proj')).toBe(
      join('/home/me', '.claude', 'projects', '-home-me-proj')
    )
  })
})

describe('newestJsonl', () => {
  it('returns null for a missing directory', async () => {
    expect(await newestJsonl(join(tmpdir(), 'does-not-exist-xyz'))).toBeNull()
  })
  it('returns the newest .jsonl and ignores other files', async () => {
    const dir = await mktmp()
    await fs.writeFile(join(dir, 'old.jsonl'), '{}', 'utf8')
    await fs.writeFile(join(dir, 'note.txt'), 'x', 'utf8')
    await new Promise((r) => setTimeout(r, 10))
    await fs.writeFile(join(dir, 'new.jsonl'), '{}', 'utf8')
    expect(await newestJsonl(dir)).toBe(join(dir, 'new.jsonl'))
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('resolveTranscript', () => {
  it('finds the newest claude session for the cwd', async () => {
    const home = await mktmp()
    const proj = claudeProjectDir(home, '/work/app')
    await fs.mkdir(proj, { recursive: true })
    await fs.writeFile(join(proj, 's1.jsonl'), '{}', 'utf8')
    expect(await resolveTranscript({ home, cwd: '/work/app' })).toBe(join(proj, 's1.jsonl'))
    await fs.rm(home, { recursive: true, force: true })
  })
  it('returns null when there is no session for the cwd', async () => {
    const home = await mktmp()
    expect(await resolveTranscript({ home, cwd: '/work/none' })).toBeNull()
    await fs.rm(home, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/transcript.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/main/transcript.ts`:

```ts
import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'

// Claude Code stores per-project session transcripts under
// ~/.claude/projects/<cwd-with-slashes-as-dashes>/<session>.jsonl
// (e.g. /home/miljan/terminaltor → -home-miljan-terminaltor).
export function claudeProjectDir(home: string, cwd: string): string {
  return join(home, '.claude', 'projects', cwd.replace(/\//g, '-'))
}

// Newest *.jsonl directly inside `dir`, or null if the dir is missing/empty.
export async function newestJsonl(dir: string): Promise<string | null> {
  let entries: import('fs').Dirent[]
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return null }
  let best: { path: string; mtimeMs: number } | null = null
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
    const full = join(dir, e.name)
    try {
      const st = await fs.stat(full)
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: st.mtimeMs }
    } catch { /* skip unreadable */ }
  }
  return best?.path ?? null
}

// Best-effort discovery of the origin agent's transcript. Claude is precise
// (per-cwd project dir); codex is a flat newest-session fallback. Returns null
// when nothing is found — the caller falls back to a manual intent note.
export async function resolveTranscript(opts: { home?: string; cwd: string; kind?: string }): Promise<string | null> {
  const home = opts.home ?? homedir()
  if (opts.kind === 'codex') return newestJsonl(join(home, '.codex', 'sessions'))
  return newestJsonl(claudeProjectDir(home, opts.cwd))
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/transcript.ts src/main/transcript.test.ts
git commit -m "feat(review): discover origin agent session transcript (claude + codex)"
```

> Note: codex sessions may be nested under date subdirectories; the flat scan is a known v1 limitation (spec §Rizici). When it returns null, the dialog's intent note covers the gap.

---

## Task 8: IPC plumbing — phase-aware resolveDir, transcript, file read

**Files:**
- Modify: `src/shared/ipc.ts:14-20`
- Modify: `src/shared/api.ts:19-22`
- Modify: `src/preload/index.ts:37-46`
- Modify: `src/main/ipc.ts` (handlers + imports)

This task is pure plumbing across the IPC boundary; verification is `npm run typecheck` plus the existing main test suite.

- [ ] **Step 1: Add channel names**

In `src/shared/ipc.ts`, inside the `IPC` object (after `reviewResolveDir` on line 15), add:

```ts
  reviewResolveTranscript: 'review:resolveTranscript',
  fsRead: 'fs:read',
```

- [ ] **Step 2: Update the API interface**

In `src/shared/api.ts`, add this import near the top (line 1 region):

```ts
import type { ReviewPhase } from './types'
```

Then replace the `resolveReviewDir` line (line 19) with these three lines:

```ts
  resolveReviewDir(originTerminalId: string, phase: ReviewPhase, round: number): Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }>
  resolveTranscript(cwd: string, kind?: string): Promise<string | null>
  readTextFile(path: string): Promise<string | null>
```

- [ ] **Step 3: Wire the preload**

In `src/preload/index.ts`, replace the `resolveReviewDir` entry (lines 38-39) with:

```ts
  resolveReviewDir: (originTerminalId, phase, round) =>
    ipcRenderer.invoke(IPC.reviewResolveDir, { originTerminalId, phase, round }) as Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }>,
  resolveTranscript: (cwd, kind) =>
    ipcRenderer.invoke(IPC.reviewResolveTranscript, { cwd, kind }) as Promise<string | null>,
  readTextFile: (path) => ipcRenderer.invoke(IPC.fsRead, { path }) as Promise<string | null>,
```

- [ ] **Step 4: Wire the main handlers**

In `src/main/ipc.ts`:

(a) After line 11 (`import { createReviewWatcher } from './reviewWatcher'`) add:

```ts
import { resolveTranscript } from './transcript'
import { promises as fsp } from 'fs'
```

(b) Replace the `reviewResolveDir` handler (lines 86-87) with:

```ts
  ipcMain.handle(IPC.reviewResolveDir, (_e, p: { originTerminalId: string; phase: import('@shared/types').ReviewPhase; round: number }) =>
    resolveReviewPaths(userDataDir, p.originTerminalId, p.phase, p.round))

  ipcMain.handle(IPC.reviewResolveTranscript, (_e, p: { cwd: string; kind?: string }) =>
    resolveTranscript({ cwd: p.cwd || os.homedir(), kind: p.kind }))

  ipcMain.handle(IPC.fsRead, async (_e, p: { path: string }) => {
    try { return await fsp.readFile(p.path, 'utf8') } catch { return null }
  })
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: errors remain ONLY in `review/useReview.ts`, `components/ReviewDialog.tsx`, `components/FeatureHeader.tsx`, `store.ts` users, and `App.tsx` (fixed in later tasks). No errors in `ipc.ts`, `api.ts`, `preload/index.ts`, `main/ipc.ts`.

- [ ] **Step 6: Run the main suite (no regressions)**

Run: `npx vitest run src/main`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(review): IPC for phase resolveDir, transcript discovery, file read"
```

---

## Task 9: store — generic `patchReviewLink`

**Files:**
- Modify: `src/renderer/src/store.ts:207-219`
- Test: `src/renderer/src/store.test.ts:374-407` (the `describe('review store')` block)

- [ ] **Step 1: Update the store tests**

In `src/renderer/src/store.test.ts`:

(a) On line 8, change the import `setReviewRound` → `patchReviewLink`.

(b) Replace the `link` helper (lines 375-378) with the new shape:

```ts
  const link = (originId: string, round = 1) => ({
    originTerminalId: originId, phase: 'spec' as const, round, maxRounds: 5,
    reviewDir: '/r', specPath: '/a/spec.md', intentPath: '/r/intent.md'
  })
```

(c) Replace the `setReviewRound` test (lines 400-407) with:

```ts
  it('patchReviewLink merges fields on a reviewer terminal', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'review: codex', kind: 'codex', review: link('o', 1) })
    const bId = getActiveTerminal(s)!.id
    s = patchReviewLink(s, bId, { phase: 'impl', round: 2 })
    const r = findReviewerFor(s, 'o')?.review
    expect(r?.phase).toBe('impl')
    expect(r?.round).toBe(2)
    expect(r?.maxRounds).toBe(5) // untouched fields preserved
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: FAIL — `patchReviewLink` not exported.

- [ ] **Step 3: Replace `setReviewRound` with `patchReviewLink`**

In `src/renderer/src/store.ts`, add the `ReviewLink` type to the existing import on line 1 (it already imports from `@shared/types` — ensure `ReviewLink` is in the list; it already is). Then replace lines 207-219 (`setReviewRound`) with:

```ts
export function patchReviewLink(state: AppState, terminalId: string, patch: Partial<ReviewLink>): AppState {
  return {
    ...state,
    workspace: mapGroups(state.workspace, (g) => ({
      ...g,
      features: g.features.map((f) => ({
        ...f,
        terminals: f.terminals.map((t) =>
          t.id === terminalId && t.review ? { ...t, review: { ...t.review, ...patch } } : t)
      }))
    }))
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(review): replace setReviewRound with generic patchReviewLink"
```

---

## Task 10: migrate — drop legacy review links on load

**Files:**
- Modify: `src/renderer/src/migrate.ts`
- Test: `src/renderer/src/migrate.test.ts` (add one case)

A persisted reviewer terminal from the old build carries a `reviewKind`-shaped `review`. Rather than half-populate the new fields, we strip such links on load (the reviewer terminal becomes a plain terminal). New-shape links (with `phase`) pass through.

- [ ] **Step 1: Add the failing test**

In `src/renderer/src/migrate.test.ts`, add inside the top-level `describe` (anywhere among the existing `it`s):

```ts
  it('strips legacy (reviewKind-shaped) review links but keeps new ones', () => {
    const ws = migrateWorkspace({
      groups: [{
        id: 'g', name: 'G', collapsed: false, cwd: '', features: [{
          id: 'f', name: 'general', collapsed: false, terminals: [
            { id: 'a', name: 'A', cwd: '', review: { originTerminalId: 'x', reviewKind: 'spec', reviewDir: '/r', round: 1 } },
            { id: 'b', name: 'B', cwd: '', review: { originTerminalId: 'x', phase: 'spec', round: 1, maxRounds: 5, reviewDir: '/r' } }
          ]
        }]
      }]
    })
    const terms = ws.groups[0].features[0].terminals
    expect(terms.find((t) => t.id === 'a')?.review).toBeUndefined()
    expect(terms.find((t) => t.id === 'b')?.review?.phase).toBe('spec')
  })
```

> If `migrate.test.ts` doesn't already import nothing else is needed — `migrateWorkspace` is the only import it uses.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/migrate.test.ts`
Expected: FAIL — terminal `a` still has its legacy `review`.

- [ ] **Step 3: Implement the sanitizer**

In `src/renderer/src/migrate.ts`, replace the whole file with:

```ts
import { Workspace, Group, Feature, Terminal } from '@shared/types'
import { createId } from '@shared/id'

// A persisted review link from before the pipeline rework has `reviewKind` and no
// `phase`. Drop it so the terminal returns to a plain terminal; keep new-shape links.
function sanitizeTerminal(t: Terminal): Terminal {
  const r = (t as { review?: Record<string, unknown> }).review
  if (r && typeof r === 'object' && !('phase' in r)) {
    const { review: _drop, ...rest } = t as Terminal & { review?: unknown }
    return rest as Terminal
  }
  return t
}

function sanitizeFeature(f: Feature): Feature {
  return { ...f, terminals: (f.terminals ?? []).map(sanitizeTerminal) }
}

// Upgrades a parsed-from-disk workspace to the current shape. Old saves stored
// terminals directly on a group (`group.terminals` + optional `group.viewMode`);
// those become a single default "general" feature. Legacy review links are stripped.
export function migrateWorkspace(raw: unknown): Workspace {
  const r = raw as { groups?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.groups)) return { groups: [] }

  const groups = r.groups.map((gv): Group => {
    const g = gv as Record<string, unknown>
    const cwd = typeof g.cwd === 'string' ? g.cwd : ''
    const collapsed = !!g.collapsed
    if (Array.isArray(g.features)) {
      return { id: g.id as string, name: g.name as string, cwd, collapsed, features: (g.features as Feature[]).map(sanitizeFeature) }
    }
    const terminals = (Array.isArray(g.terminals) ? g.terminals : []) as Terminal[]
    const feature: Feature = {
      id: createId(),
      name: 'general',
      collapsed: false,
      viewMode: g.viewMode as ('tabs' | 'grid' | undefined),
      terminals: terminals.map(sanitizeTerminal)
    }
    return { id: g.id as string, name: g.name as string, cwd, collapsed, features: [feature] }
  })
  return { groups }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/migrate.test.ts`
Expected: PASS (existing cases + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/migrate.ts src/renderer/src/migrate.test.ts
git commit -m "feat(review): strip legacy review links during workspace migration"
```

---

## Task 11: `useReview.ts` — the auto state machine (glue)

**Files:**
- Modify: `src/renderer/src/review/useReview.ts` (full rewrite below)

This hook is orchestration glue (no unit test, matching the existing codebase — all decisions live in the already-tested `verdict`/`phases`/`prompt` modules). Verification is `npm run typecheck` here and a manual smoke at the end.

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `src/renderer/src/review/useReview.ts` with:

```ts
import { useRef, useCallback } from 'react'
import type { AppState } from '../store'
import { addTerminal, patchReviewLink, findReviewerFor, featureIdOfTerminal, getTerminalById } from '../store'
import type { ReviewPhase, ReviewStatus, ReviewLink } from '@shared/types'
import { createId } from '@shared/id'
import { AGENTS, type AgentKind } from '../agents'
import { buildReviewerCommand, reviewerStartupPrompt, reviewerInjectPrompt, relayToOriginPrompt } from './prompt'
import { parseVerdict } from './verdict'
import { nextPhase, afterApply } from './phases'

export interface StartReviewArgs {
  originTerminalId: string
  reviewer: AgentKind
  phase: ReviewPhase
  maxRounds: number
  specPath?: string
  intent?: string
}

export function useReview(
  state: AppState,
  apply: (fn: (s: AppState) => AppState) => void,
  setStatus: (id: string, status: ReviewStatus | undefined) => void
) {
  // watchId → the reviewer + file we're waiting on (its critique write).
  const watching = useRef(new Map<string, { reviewerId: string; reviewFile: string }>())
  // originId → arming phase for the "origin finished applying" busy→idle signal.
  const awaiting = useRef(new Map<string, 'pending' | 'working'>())

  const armReviewWatch = useCallback((reviewerId: string, reviewFile: string, phase: ReviewPhase, round: number) => {
    const watchId = `review:${reviewerId}:${phase}:${round}`
    watching.current.set(watchId, { reviewerId, reviewFile })
    window.orchestrix.watchFile(watchId, reviewFile)
  }, [])

  // Send a review request for (phase, round) into the existing reviewer PTY and
  // re-arm the watch. Shared by every round/phase after the initial spawn.
  const requestReview = useCallback((link: ReviewLink, reviewerId: string, phase: ReviewPhase, round: number, reviewFile: string) => {
    const prompt = reviewerInjectPrompt({
      phase, round, reviewFile,
      transcriptPath: link.transcriptPath, intentPath: link.intentPath, specPath: link.specPath
    })
    window.orchestrix.writePty(reviewerId, prompt + '\r')
    setStatus(reviewerId, 'reviewing')
    setStatus(link.originTerminalId, 'under-review')
    armReviewWatch(reviewerId, reviewFile, phase, round)
  }, [setStatus, armReviewWatch])

  // 1. Start a brand-new review: spawn the reviewer terminal bound to the origin.
  const startReview = useCallback(async (a: StartReviewArgs) => {
    const featureId = featureIdOfTerminal(state, a.originTerminalId)
    if (!featureId) return
    const origin = getTerminalById(state, a.originTerminalId)
    const round = 1
    const paths = await window.orchestrix.resolveReviewDir(a.originTerminalId, a.phase, round)
    const transcriptPath = await window.orchestrix.resolveTranscript(origin?.cwd ?? '', origin?.kind)
    const link: ReviewLink = {
      originTerminalId: a.originTerminalId,
      phase: a.phase, round, maxRounds: a.maxRounds,
      reviewDir: paths.reviewDir,
      transcriptPath: transcriptPath ?? undefined,
      intentPath: paths.intentPath,
      specPath: a.specPath?.trim() || paths.specPath
    }
    const startup = reviewerStartupPrompt({
      phase: a.phase, round, reviewFile: paths.reviewFile,
      transcriptPath: link.transcriptPath, intentPath: link.intentPath, specPath: link.specPath, intent: a.intent
    })
    const reviewerId = createId()
    apply((s) => addTerminal(s, featureId, {
      id: reviewerId, name: `review: ${a.reviewer}`, kind: a.reviewer,
      startupCommand: buildReviewerCommand(AGENTS[a.reviewer].command, startup), review: link
    }))
    setStatus(reviewerId, 'reviewing')
    setStatus(a.originTerminalId, 'under-review')
    armReviewWatch(reviewerId, paths.reviewFile, a.phase, round)
  }, [state, apply, setStatus, armReviewWatch])

  // 2. Reviewer wrote its critique → read it, parse the verdict, branch.
  const handleFsChanged = useCallback(async (watchId: string) => {
    const w = watching.current.get(watchId)
    if (!w) return
    watching.current.delete(watchId)
    window.orchestrix.unwatchFile(watchId)
    const reviewer = getTerminalById(state, w.reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const text = (await window.orchestrix.readTextFile(w.reviewFile)) ?? ''
    if (parseVerdict(text) === 'approved') {
      setStatus(reviewer.id, 'phase-approved')        // ⛔ gate — wait for the user
      setStatus(link.originTerminalId, undefined)     // clear the origin indicator at the gate
      return
    }
    // NEEDS-WORK → auto-relay to the origin and wait for it to finish applying.
    const relay = relayToOriginPrompt({ phase: link.phase, reviewFile: w.reviewFile, intentPath: link.intentPath, specPath: link.specPath })
    window.orchestrix.writePty(link.originTerminalId, relay + '\r')
    setStatus(reviewer.id, undefined)
    setStatus(link.originTerminalId, 'applying')
    awaiting.current.set(link.originTerminalId, 'pending')
  }, [state, setStatus])

  // 3. Origin busy→idle while applying → next round (or stop at the cap).
  const handleBusy = useCallback(async (id: string, busy: boolean) => {
    const arm = awaiting.current.get(id)
    if (!arm) return
    if (busy) { awaiting.current.set(id, 'working'); return }  // origin started producing output
    if (arm !== 'working') return                             // ignore idle before any work began
    awaiting.current.delete(id)
    const reviewer = findReviewerFor(state, id)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const decision = afterApply(link.round, link.maxRounds)
    if (decision.type === 'stop') {
      setStatus(reviewer.id, 'needs-decision')
      setStatus(id, undefined)
      return
    }
    const paths = await window.orchestrix.resolveReviewDir(id, link.phase, decision.round)
    apply((s) => patchReviewLink(s, reviewer.id, { round: decision.round }))
    requestReview(link, reviewer.id, link.phase, decision.round, paths.reviewFile)
  }, [state, apply, setStatus, requestReview])

  // 4. User gate: approve the phase → advance to the next (or finish the pipeline).
  const advancePhase = useCallback(async (reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const np = nextPhase(link.phase)
    if (!np) {                                  // impl approved → done
      setStatus(reviewer.id, undefined)
      setStatus(link.originTerminalId, undefined)
      return
    }
    const round = 1
    const paths = await window.orchestrix.resolveReviewDir(link.originTerminalId, np, round)
    apply((s) => patchReviewLink(s, reviewer.id, { phase: np, round }))
    requestReview(link, reviewer.id, np, round, paths.reviewFile)
  }, [state, apply, setStatus, requestReview])

  // 5a. needs-decision: raise the cap and run more rounds.
  const moreRounds = useCallback(async (reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const round = link.round + 1
    const maxRounds = link.maxRounds + 3
    const paths = await window.orchestrix.resolveReviewDir(link.originTerminalId, link.phase, round)
    apply((s) => patchReviewLink(s, reviewer.id, { round, maxRounds }))
    requestReview({ ...link, maxRounds }, reviewer.id, link.phase, round, paths.reviewFile)
  }, [state, apply, requestReview])

  // 5b. needs-decision: accept the current state and move to the user gate.
  const acceptPhase = useCallback((reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    if (!reviewer?.review) return
    setStatus(reviewer.id, 'phase-approved')
    setStatus(reviewer.review.originTerminalId, undefined)
  }, [state, setStatus])

  // 6. Stop the loop entirely (manual escape).
  const stopLoop = useCallback((reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    awaiting.current.delete(link.originTerminalId)
    for (const [watchId, w] of [...watching.current]) {
      if (w.reviewerId === reviewer.id) { window.orchestrix.unwatchFile(watchId); watching.current.delete(watchId) }
    }
    setStatus(reviewer.id, undefined)
    setStatus(link.originTerminalId, undefined)
  }, [state, setStatus])

  return { startReview, handleFsChanged, handleBusy, advancePhase, moreRounds, acceptPhase, stopLoop }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: errors remain ONLY in `components/ReviewDialog.tsx`, `components/FeatureHeader.tsx`, and `App.tsx` (next tasks). No errors in `useReview.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/review/useReview.ts
git commit -m "feat(review): auto state-machine — verdict branch, busy-idle loop, phase gate"
```

---

## Task 12: `ReviewDialog.tsx` — choose start phase + maxRounds

**Files:**
- Modify: `src/renderer/src/components/ReviewDialog.tsx` (full rewrite below)
- Test: `src/renderer/src/components/ReviewDialog.test.tsx` (full rewrite below)

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `src/renderer/src/components/ReviewDialog.test.tsx` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewDialog } from './ReviewDialog'

beforeEach(() => {
  // @ts-expect-error test stub
  window.orchestrix = {
    suggestSpec: vi.fn().mockResolvedValue('/p/docs/spec.md'),
    pickFile: vi.fn().mockResolvedValue('/p/other.md')
  }
})

const baseProps = { originName: 'claude', defaultReviewer: 'codex' as const, cwd: '/p' }

describe('ReviewDialog', () => {
  it('defaults to the intent phase with maxRounds 5 and no spec field', () => {
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Intent')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Max rounds')).toHaveValue(5)
    expect(screen.queryByLabelText('Spec file')).toBeNull()
  })

  it('starts an intent review with the chosen reviewer and maxRounds', () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Max rounds'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', phase: 'intent', maxRounds: 3, specPath: undefined, intent: '' })
  })

  it('spec phase shows + prefills the spec file and passes it on start', async () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Spec/plan'))
    await waitFor(() => expect(screen.getByLabelText('Spec file')).toHaveValue('/p/docs/spec.md'))
    fireEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', phase: 'spec', maxRounds: 5, specPath: '/p/docs/spec.md', intent: '' })
  })

  it('closes on Escape', () => {
    const onCancel = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/components/ReviewDialog.test.tsx`
Expected: FAIL — phase/maxRounds controls don't exist yet.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `src/renderer/src/components/ReviewDialog.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import type { ReviewPhase } from '@shared/types'
import type { AgentKind } from '../agents'
import { PHASE_ORDER, PHASE_LABEL } from '../review/phases'

export interface ReviewStartArgs {
  reviewer: AgentKind
  phase: ReviewPhase
  maxRounds: number
  specPath?: string
  intent: string
}

export function ReviewDialog({
  originName, defaultReviewer, cwd, onStart, onCancel
}: {
  originName: string
  defaultReviewer: AgentKind
  cwd: string
  onStart: (args: ReviewStartArgs) => void
  onCancel: () => void
}) {
  const [reviewer, setReviewer] = useState<AgentKind>(defaultReviewer)
  const [phase, setPhase] = useState<ReviewPhase>('intent')
  const [maxRounds, setMaxRounds] = useState(5)
  const [specPath, setSpecPath] = useState('')
  const [intent, setIntent] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Prefill a suggested spec only when the spec field is relevant (spec/impl phases).
  useEffect(() => {
    if (phase === 'intent' || specPath) return
    let cancelled = false
    window.orchestrix.suggestSpec(cwd).then((p) => { if (!cancelled && p) setSpecPath(p) })
    return () => { cancelled = true }
  }, [phase, cwd, specPath])

  const browse = async () => {
    const p = await window.orchestrix.pickFile({ defaultPath: specPath || cwd })
    if (p) setSpecPath(p)
  }

  const submit = () => {
    onStart({
      reviewer, phase, maxRounds,
      specPath: phase === 'intent' ? undefined : (specPath.trim() || undefined),
      intent: intent.trim()
    })
  }

  const field = 'mt-1 w-full rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition'
  const seg = (active: boolean) =>
    `px-3 py-1 text-sm rounded-md transition ${active ? 'bg-accent text-surface' : 'bg-field text-fg-muted hover:text-fg'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[30rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold tracking-tight text-fg-bright">Review</h2>
        <p className="mb-4 text-xs text-fg-muted">Reviewing terminal “{originName}”.</p>

        <div className="mb-3">
          <span className="text-sm text-fg">Reviewer</span>
          <div className="mt-1 flex gap-2">
            <button type="button" className={seg(reviewer === 'claude')} onClick={() => setReviewer('claude')}>Claude</button>
            <button type="button" className={seg(reviewer === 'codex')} onClick={() => setReviewer('codex')}>Codex</button>
          </div>
        </div>

        <div className="mb-3">
          <span className="text-sm text-fg">Start phase</span>
          <div className="mt-1 flex gap-2">
            {PHASE_ORDER.map((p) => (
              <button key={p} type="button" aria-label={PHASE_LABEL[p]} aria-pressed={phase === p}
                className={seg(phase === p)} onClick={() => setPhase(p)}>{PHASE_LABEL[p]}</button>
            ))}
          </div>
        </div>

        <label className="block mb-3 text-sm text-fg">
          Max rounds
          <input aria-label="Max rounds" type="number" min={1} value={maxRounds}
            onChange={(e) => setMaxRounds(Math.max(1, Number(e.target.value) || 1))}
            className={field} />
        </label>

        {phase !== 'intent' && (
          <label className="block mb-3 text-sm text-fg">
            Spec file
            <div className="mt-1 flex gap-2">
              <input aria-label="Spec file" value={specPath} onChange={(e) => setSpecPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field.replace('mt-1 ', '')} />
              <button type="button" onClick={browse} className="shrink-0 rounded-md bg-field px-3 text-sm text-fg-muted hover:text-fg transition">Browse…</button>
            </div>
          </label>
        )}

        <label className="block mb-4 text-sm text-fg">
          Intent (optional)
          <input aria-label="Intent (optional)" value={intent} placeholder="what's the goal…"
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field} />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors">Cancel</button>
          <button onClick={submit} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:bg-accent-strong transition-colors">Start review</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/components/ReviewDialog.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ReviewDialog.tsx src/renderer/src/components/ReviewDialog.test.tsx
git commit -m "feat(review): dialog selects start phase + maxRounds"
```

---

## Task 13: `FeatureHeader.tsx` — review-control buttons

**Files:**
- Modify: `src/renderer/src/components/FeatureHeader.tsx` (full rewrite below)
- Test: `src/renderer/src/components/FeatureHeader.test.tsx` (rewrite the review-button assertions)

The header replaces the old manual relay buttons (`→ Return to A`, `↻ Re-review`, `✓ Done`) with pipeline controls driven by a single `review` prop.

- [ ] **Step 1: Rewrite the test**

Replace the entire contents of `src/renderer/src/components/FeatureHeader.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeatureHeader } from './FeatureHeader'

const noReview = { reviewerId: null, canApprove: false, isLast: false, needsDecision: false, active: false }
const base = {
  featureName: 'auth', viewMode: 'tabs' as const, onToggleView: vi.fn(), onAdd: vi.fn(),
  onApprovePhase: vi.fn(), onMoreRounds: vi.fn(), onAcceptPhase: vi.fn(), onStopLoop: vi.fn()
}

describe('FeatureHeader', () => {
  it('shows the feature name and the grid toggle', () => {
    render(<FeatureHeader {...base} review={noReview} />)
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument()
  })

  it('grid toggle calls onToggleView', () => {
    const onToggleView = vi.fn()
    render(<FeatureHeader {...base} onToggleView={onToggleView} review={noReview} />)
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(onToggleView).toHaveBeenCalled()
  })

  it('shows "Stani petlju" while the loop is active', () => {
    const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onStopLoop={onStopLoop} review={{ ...noReview, reviewerId: 'b', active: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stani petlju' }))
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })

  it('shows the phase gate and calls onApprovePhase', () => {
    const onApprovePhase = vi.fn()
    render(<FeatureHeader {...base} onApprovePhase={onApprovePhase} review={{ ...noReview, reviewerId: 'b', canApprove: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Odobri → sljedeća faza' }))
    expect(onApprovePhase).toHaveBeenCalledWith('b')
  })

  it('labels the last-phase gate "Završi"', () => {
    render(<FeatureHeader {...base} review={{ ...noReview, reviewerId: 'b', canApprove: true, isLast: true }} />)
    expect(screen.getByRole('button', { name: 'Završi' })).toBeInTheDocument()
  })

  it('shows the three decision buttons on needs-decision', () => {
    const onMoreRounds = vi.fn(); const onAcceptPhase = vi.fn(); const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onMoreRounds={onMoreRounds} onAcceptPhase={onAcceptPhase} onStopLoop={onStopLoop}
      review={{ ...noReview, reviewerId: 'b', needsDecision: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Još rundi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prihvati ovako' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onMoreRounds).toHaveBeenCalledWith('b')
    expect(onAcceptPhase).toHaveBeenCalledWith('b')
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/components/FeatureHeader.test.tsx`
Expected: FAIL — new `review` prop / buttons don't exist.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `src/renderer/src/components/FeatureHeader.tsx` with:

```tsx
import { GridIcon } from './icons'
import { AddMenuButton, type AddKind } from './AddMenuButton'

export interface ReviewControl {
  reviewerId: string | null
  canApprove: boolean    // phase APPROVED → user gate
  isLast: boolean        // current phase is the last (impl)
  needsDecision: boolean // maxRounds reached
  active: boolean        // loop running (reviewing or applying)
}

export function FeatureHeader({
  featureName, viewMode, onToggleView, onAdd,
  review, onApprovePhase, onMoreRounds, onAcceptPhase, onStopLoop
}: {
  featureName: string
  viewMode: 'tabs' | 'grid'
  onToggleView: () => void
  onAdd: (kind: AddKind) => void
  review: ReviewControl
  onApprovePhase: (reviewerId: string) => void
  onMoreRounds: (reviewerId: string) => void
  onAcceptPhase: (reviewerId: string) => void
  onStopLoop: (reviewerId: string) => void
}) {
  const rid = review.reviewerId
  const btn = 'px-2 text-xs rounded bg-field text-accent hover:bg-hover transition'
  const btnMuted = 'px-2 text-xs rounded bg-field text-fg-muted hover:text-fg transition'
  return (
    <div className="flex items-center gap-2 h-9 px-3 bg-panel border-b border-line">
      <span className="truncate text-sm font-medium text-fg-bright">{featureName}</span>
      <div className="ml-auto flex items-center gap-0.5 text-base leading-none">
        {rid && review.canApprove && (
          <button onClick={() => onApprovePhase(rid)} title="Approve this phase and continue"
            className={btn}>{review.isLast ? 'Završi' : 'Odobri → sljedeća faza'}</button>
        )}
        {rid && review.needsDecision && (
          <>
            <button onClick={() => onMoreRounds(rid)} title="Run more rounds" className={btn}>Još rundi</button>
            <button onClick={() => onAcceptPhase(rid)} title="Accept as-is and move to the gate" className={btnMuted}>Prihvati ovako</button>
            <button onClick={() => onStopLoop(rid)} title="Stop the review loop" className={btnMuted}>Stop</button>
          </>
        )}
        {rid && review.active && !review.needsDecision && !review.canApprove && (
          <button onClick={() => onStopLoop(rid)} title="Stop the review loop" className={btnMuted}>Stani petlju</button>
        )}
        <button
          aria-label={viewMode === 'grid' ? 'Tabs view' : 'Grid view'}
          aria-pressed={viewMode === 'grid'}
          title={viewMode === 'grid' ? 'Switch to tabs' : 'Switch to grid'}
          onClick={onToggleView}
          className={`px-1.5 transition-colors ${viewMode === 'grid' ? 'text-accent' : 'text-fg-muted hover:text-accent'}`}
        >
          <GridIcon />
        </button>
        <AddMenuButton onAdd={onAdd} className="px-1.5 text-sm text-fg-muted hover:text-accent transition-colors" />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/components/FeatureHeader.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/FeatureHeader.tsx src/renderer/src/components/FeatureHeader.test.tsx
git commit -m "feat(review): feature-header pipeline controls (gate/decision/stop)"
```

---

## Task 14: `App.tsx` — wire the loop, controls, and origin indicator

**Files:**
- Modify: `src/renderer/src/App.tsx` (imports, busy subscription, control derivation, FeatureHeader + ReviewDialog wiring)

Glue task — verified by typecheck + the full renderer suite + manual smoke.

- [ ] **Step 1: Add the `nextPhase` import**

In `src/renderer/src/App.tsx`, after line 16 (`import { useReview } from './review/useReview'`) add:

```ts
import { nextPhase } from './review/phases'
```

- [ ] **Step 2: Subscribe the review loop to busy transitions**

After the existing busy effect (lines 59-61), add a second subscription that feeds the review state machine:

```ts
  useEffect(() => window.orchestrix.onPtyBusy(review.handleBusy), [review.handleBusy])
```

(Place it immediately after `const review = useReview(...)` on line 69 so `review` is defined — move it below line 70 if your editor flags use-before-define. The existing `onFsChanged` subscription on line 70 is the right neighbor.)

- [ ] **Step 3: Replace the relay-flags block with review-control derivation**

Replace lines 102-108 (the `activeIsReviewer` / `activeIsOrigin` / `relayFlags` block) with:

```ts
  // The pipeline controls live on the feature's reviewer terminal (the one with a
  // review link); both origin and reviewer share the feature, so derive from it.
  const featureReviewer = activeFeature?.terminals.find((t) => !!t.review) ?? null
  const reviewerStatus = featureReviewer ? reviewStatus[featureReviewer.id] : undefined
  const originStatus = featureReviewer?.review ? reviewStatus[featureReviewer.review.originTerminalId] : undefined
  const reviewControl = {
    reviewerId: featureReviewer?.id ?? null,
    canApprove: reviewerStatus === 'phase-approved',
    isLast: featureReviewer?.review ? nextPhase(featureReviewer.review.phase) === null : false,
    needsDecision: reviewerStatus === 'needs-decision',
    active: reviewerStatus === 'reviewing' || originStatus === 'applying'
  }
```

- [ ] **Step 4: Rewrite the `FeatureHeader` usage**

Replace the `<FeatureHeader ... />` block (lines 208-219) with:

```tsx
          <FeatureHeader
            featureName={activeFeature.name}
            viewMode={activeFeature.viewMode ?? 'tabs'}
            onToggleView={() => apply((s) => toggleFeatureViewMode(s, activeFeature.id))}
            onAdd={(kind) => (kind === 'shell'
              ? addShellTerminal(activeFeature.id)
              : launchAgent(activeFeature.id, kind))}
            review={reviewControl}
            onApprovePhase={(rid) => void review.advancePhase(rid)}
            onMoreRounds={(rid) => void review.moreRounds(rid)}
            onAcceptPhase={(rid) => review.acceptPhase(rid)}
            onStopLoop={(rid) => review.stopLoop(rid)}
          />
```

- [ ] **Step 5: Update the `startReview` call to the new args**

The `startReview` handler (lines 109-113) already spreads `...args` from the dialog; since `ReviewStartArgs` now carries `phase`/`maxRounds` instead of `kind`, no change is needed there — confirm it reads:

```ts
  const startReview = (args: ReviewStartArgs) => {
    if (!reviewReq) return
    void review.startReview({ originTerminalId: reviewReq.id, ...args })
    setReviewReq(null)
  }
```

- [ ] **Step 6: Typecheck (must be clean now)**

Run: `npm run typecheck`
Expected: PASS — zero errors across the project.

- [ ] **Step 7: Full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(review): wire busy→loop, pipeline controls, origin indicator"
```

---

## Task 15: Manual smoke test + verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + full suite once more (evidence before claims)**

Run: `npm run typecheck && npx vitest run`
Expected: both PASS. Capture the final test summary line.

- [ ] **Step 2: Launch the app**

Run: `npm run dev`

Then exercise the pipeline by hand:
- [ ] Create a project pointing at a repo with a running `claude` terminal that has had a short conversation (so a transcript exists under `~/.claude/projects/<enc-cwd>/`).
- [ ] Click **Review** on that terminal → dialog shows **Start phase = Intent**, **Max rounds = 5**. Start.
- [ ] A `review:` terminal spawns (spinner). Origin shows the blue **under-review** dot.
- [ ] Reviewer writes its critique. If `VERDICT: NEEDS-WORK`: the critique is auto-sent to the origin (origin spinner = applying); when the origin goes idle, the next round starts automatically.
- [ ] On `VERDICT: APPROVED`: reviewer shows the yellow attention dot and the header shows **Odobri → sljedeća faza**. Click it → spec phase begins.
- [ ] Verify **Stani petlju** stops the loop; verify the **needs-decision** buttons appear if you set Max rounds low (e.g. 1).
- [ ] Verify `intent.md` / `spec.md` / `review-*.md` appear under the app's `userData/reviews/<originId>/` (not in the repo / git).

- [ ] **Step 3: Note any gaps**

If the transcript isn't found (codex, or an unusual cwd encoding), confirm the dialog's **Intent** note still drives the intent phase, and log it as the known limitation from the spec.

---

## Self-Review

**Spec coverage** (each design decision → task):
- Pipeline `intent → spec → impl` → Task 3 (`phases`), Task 11 (`advancePhase`).
- Auto loop, reviewer judges APPROVED/NEEDS-WORK, maxRounds → Task 2 (`verdict`), Task 3 (`afterApply`), Task 11 (`handleFsChanged`/`handleBusy`).
- Transcript as conversation source → Task 7 (`transcript`), Task 8 (IPC), Task 11 (`resolveTranscript` in `startReview`).
- User gate per phase → Task 13 (gate button), Task 11 (`advancePhase`), Task 14 (`canApprove`).
- intent.md artifact → Task 6 (`intentPath`), Task 4 (intent prompts), Task 11 (relay to intent doc).
- Reviewer bound to origin, reused → Task 11 (single reviewer terminal, `requestReview` re-prompts it).
- Skip starting phase → Task 12 (start-phase selector).
- Auto next-round on idle + Stani petlju → Task 11 (`handleBusy`, `stopLoop`), Task 13/14 (button).
- Origin under-review indicator → Task 1 (`under-review`), Task 5 (`active` dot), Task 11 (set on origin), Task 14 (derivation).
- Migration of legacy links → Task 10.
- VERDICT default-to-needs-work, codex transcript limitation → Task 2 + Task 7 notes.

**Placeholder scan:** none — every code step contains complete source.

**Type consistency:** `ReviewPhase`/`ReviewLink`/`ReviewStatus` (Task 1) are used identically across `prompt`, `phases`, `verdict`, `reviewFs`, `transcript`, `useReview`, `ReviewDialog`, `FeatureHeader`, `App`. `resolveReviewDir` returns `{reviewDir, reviewFile, intentPath, specPath}` in Task 6/8 and is consumed with those exact keys in Task 11. `patchReviewLink` (Task 9) signature matches all call sites in Task 11. `ReviewControl` shape (Task 13) matches the object built in Task 14.

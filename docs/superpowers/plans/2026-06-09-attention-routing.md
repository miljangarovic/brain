# Attention Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the user when a claude/codex agent terminal needs them — waiting on a prompt, finished (idle), or exited with an error — via OS notification, sound, a sidebar dot, and an attention queue.

**Architecture:** Pure, unit-tested renderer modules (`detect`, `decide`, `queue`, `notify`, `sound`, `tailRegistry`) hold all logic; a thin `useAttention` hook wires them to the existing `pty:busy` / `pty:exit` streams (mirroring `useReview`, which is itself untested — only its pure helpers are). A new main-side `notifications` factory (DI, tested) creates Electron `Notification`s. UI is a per-terminal `AttentionDot` plus a global `AttentionBell` popover at the top of the sidebar.

**Tech Stack:** Electron, React 18 + TypeScript, Vite, Tailwind, Vitest + @testing-library/react (jsdom), xterm.js.

---

## Conventions (read once)

- Tests live next to source as `<name>.test.ts(x)`. Run a single file with
  `npx vitest run <path>`. Run everything with `npm test`. Typecheck with
  `npm run typecheck`.
- Tests import `{ describe, it, expect, vi }` explicitly from `vitest` (the repo
  does this even though `globals: true`). Component tests use
  `render, screen, fireEvent` from `@testing-library/react`.
- The shared alias `@shared` → `src/shared`. Renderer-only types stay in the
  renderer.
- `AttentionState` is `'waiting-input' | 'done' | 'error'`; "no attention" is
  `undefined` (mirrors `ReviewStatus | undefined`).
- **Wiring is not unit-tested** (hook, preload, IPC registration, App glue) —
  this matches the codebase (`useReview.ts`, `preload/index.ts` have no tests).
  Those tasks verify via `npm run typecheck` + the final manual smoke test. Do
  NOT invent brittle hook/preload tests.
- Commit after every task with the exact message shown.

## File Structure

**Create (renderer):**
- `src/renderer/src/attention/detect.ts` — `AttentionState`, `stripAnsi`, `PERMISSION_PATTERNS`, `classifyIdle`
- `src/renderer/src/attention/decide.ts` — `decideOnIdle`, `decideOnExit` (suppression logic)
- `src/renderer/src/attention/queue.ts` — `AttentionItem`, `upsertItem`, `removeItem`, `lastLineOf`
- `src/renderer/src/attention/notify.ts` — `notifTitle`
- `src/renderer/src/attention/sound.ts` — `isMuted`, `setMuted`, `beep`
- `src/renderer/src/attention/tailRegistry.ts` — `registerTail`, `unregisterTail`, `readTail`, `readXtermTail`
- `src/renderer/src/attention/useAttention.ts` — the hook (no test)
- `src/renderer/src/components/AttentionDot.tsx` — per-terminal dot
- `src/renderer/src/components/AttentionBell.tsx` — global bell + queue popover
- matching `*.test.ts(x)` for every file above except `useAttention.ts`

**Create (main):**
- `src/main/notifications.ts` — `createNotifier` factory + `src/main/notifications.test.ts`

**Modify:**
- `src/shared/ipc.ts` — add `notifyShow`, `notificationClick`
- `src/shared/api.ts` — add `showNotification`, `onNotificationClick`
- `src/preload/index.ts` — implement both
- `src/main/ipc.ts` — wire the notifier
- `src/renderer/src/store.ts` — add `isUnderReview`, `terminalPath` (+ tests in `store.test.ts`)
- `src/renderer/src/components/icons.tsx` — add `BellIcon`, `SpeakerIcon`, `SpeakerMutedIcon` (+ test additions)
- `src/renderer/src/components/Sidebar.tsx` — render `AttentionDot`, host `AttentionBell`
- `src/renderer/src/components/TabBar.tsx` — render `AttentionDot`
- `src/renderer/src/App.tsx` — instantiate `useAttention`, subscribe, pass props

---

## Task 1: Detection (`detect.ts`)

**Files:**
- Create: `src/renderer/src/attention/detect.ts`
- Test: `src/renderer/src/attention/detect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/attention/detect.test.ts
import { describe, it, expect } from 'vitest'
import { stripAnsi, classifyIdle } from './detect'

describe('stripAnsi', () => {
  it('removes CSI colour sequences', () => {
    expect(stripAnsi('\x1b[33mhi\x1b[0m')).toBe('hi')
  })
  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text')
  })
  it('leaves plain text untouched', () => {
    expect(stripAnsi('do you want to proceed?')).toBe('do you want to proceed?')
  })
})

describe('classifyIdle', () => {
  it('flags a (y/n) prompt as waiting-input', () => {
    expect(classifyIdle('Apply this change? (y/n)')).toBe('waiting-input')
  })
  it('flags a numbered choice menu as waiting-input', () => {
    expect(classifyIdle('  ❯ 1. Yes\n    2. No')).toBe('waiting-input')
  })
  it('flags a "Do you want" prompt even with colour codes', () => {
    expect(classifyIdle('\x1b[1mDo you want to allow this?\x1b[0m')).toBe('waiting-input')
  })
  it('treats ordinary trailing output as done', () => {
    expect(classifyIdle('All tests passed. 42 files changed.')).toBe('done')
  })
  it('treats empty input as done', () => {
    expect(classifyIdle('')).toBe('done')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/attention/detect.test.ts`
Expected: FAIL — cannot find module `./detect`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/attention/detect.ts
export type AttentionState = 'waiting-input' | 'done' | 'error'

// Strip ANSI escape sequences so prompt matching works on clean text. (xterm's
// buffer is already mostly de-escaped, but a stray sequence shouldn't break a match.)
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC ... BEL or ST
    .replace(/\x1B[@-Z\\-_]/g, '')                     // single-char escapes
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')         // CSI sequences
}

// Patterns that mark "the agent stopped on a question and is blocked on you".
// Small and easily extended; case-insensitive. A miss falls back to 'done', so a
// wrong pattern only mislabels — the user still gets an "agent needs you" signal.
export const PERMISSION_PATTERNS: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\bdo you want\b/i,
  /\bwould you like\b/i,
  /\bapprove\b/i,
  /\ballow\b/i,
  /\bproceed\?/i,
  /\bpress enter\b/i,
  /\bcontinue\?/i,
  /❯\s*\d+\./, // numbered choice prompt (claude/codex menus)
]

// Classify a terminal that just went idle from its recent output tail.
export function classifyIdle(tail: string): 'waiting-input' | 'done' {
  const clean = stripAnsi(tail)
  return PERMISSION_PATTERNS.some((re) => re.test(clean)) ? 'waiting-input' : 'done'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/attention/detect.test.ts`
Expected: PASS (9 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/attention/detect.ts src/renderer/src/attention/detect.test.ts
git commit -m "feat(attention): output-tail detection (classifyIdle + stripAnsi)"
```

---

## Task 2: Suppression decision (`decide.ts`)

**Files:**
- Create: `src/renderer/src/attention/decide.ts`
- Test: `src/renderer/src/attention/decide.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/attention/decide.test.ts
import { describe, it, expect } from 'vitest'
import { decideOnIdle, decideOnExit } from './decide'

const ctx = (over: Partial<Parameters<typeof decideOnIdle>[1]> = {}) =>
  ({ isAgent: true, underReview: false, activeAndFocused: false, ...over })

describe('decideOnIdle', () => {
  it('returns the classified state for a backgrounded agent', () => {
    expect(decideOnIdle('done', ctx())).toBe('done')
    expect(decideOnIdle('waiting-input', ctx())).toBe('waiting-input')
  })
  it('ignores non-agent terminals', () => {
    expect(decideOnIdle('done', ctx({ isAgent: false }))).toBeNull()
  })
  it('ignores terminals the review loop owns', () => {
    expect(decideOnIdle('done', ctx({ underReview: true }))).toBeNull()
  })
  it('stays silent when you are already looking at it', () => {
    expect(decideOnIdle('waiting-input', ctx({ activeAndFocused: true }))).toBeNull()
  })
})

describe('decideOnExit', () => {
  it('flags a non-zero exit as error', () => {
    expect(decideOnExit(1, ctx())).toBe('error')
  })
  it('stays silent on a clean (0) exit', () => {
    expect(decideOnExit(0, ctx())).toBeNull()
  })
  it('ignores non-agent / under-review / focused', () => {
    expect(decideOnExit(1, ctx({ isAgent: false }))).toBeNull()
    expect(decideOnExit(1, ctx({ underReview: true }))).toBeNull()
    expect(decideOnExit(1, ctx({ activeAndFocused: true }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/attention/decide.test.ts`
Expected: FAIL — cannot find module `./decide`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/attention/decide.ts
import type { AttentionState } from './detect'

export interface DecideCtx {
  isAgent: boolean          // terminal kind is claude/codex
  underReview: boolean      // reviewer terminal, or an origin under an active review
  activeAndFocused: boolean // user is currently looking at this terminal
}

// Common gate: only agents, never review-owned terminals, never while you watch it.
function suppressed(ctx: DecideCtx): boolean {
  return !ctx.isAgent || ctx.underReview || ctx.activeAndFocused
}

// busy→idle: the classified state to set, or null to do nothing.
export function decideOnIdle(state: 'waiting-input' | 'done', ctx: DecideCtx): AttentionState | null {
  return suppressed(ctx) ? null : state
}

// pty exit: 'error' for a non-zero code, else null (clean exit is intentional).
export function decideOnExit(code: number, ctx: DecideCtx): AttentionState | null {
  if (suppressed(ctx) || code === 0) return null
  return 'error'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/attention/decide.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/attention/decide.ts src/renderer/src/attention/decide.test.ts
git commit -m "feat(attention): suppression decision (decideOnIdle/decideOnExit)"
```

---

## Task 3: Queue helpers (`queue.ts`)

**Files:**
- Create: `src/renderer/src/attention/queue.ts`
- Test: `src/renderer/src/attention/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/attention/queue.test.ts
import { describe, it, expect } from 'vitest'
import { upsertItem, removeItem, lastLineOf, type AttentionItem } from './queue'

const item = (terminalId: string, ts: number): AttentionItem =>
  ({ terminalId, state: 'done', lastLine: '', ts })

describe('upsertItem', () => {
  it('adds an item newest-first', () => {
    const q = upsertItem(upsertItem([], item('a', 1)), item('b', 2))
    expect(q.map((x) => x.terminalId)).toEqual(['b', 'a'])
  })
  it('replaces an existing item for the same terminal and re-sorts', () => {
    let q = upsertItem([], item('a', 1))
    q = upsertItem(q, item('b', 2))
    q = upsertItem(q, item('a', 3)) // a moves to the front
    expect(q.map((x) => x.terminalId)).toEqual(['a', 'b'])
    expect(q).toHaveLength(2)
  })
})

describe('removeItem', () => {
  it('drops the item for a terminal', () => {
    const q = removeItem([item('a', 1), item('b', 2)], 'a')
    expect(q.map((x) => x.terminalId)).toEqual(['b'])
  })
})

describe('lastLineOf', () => {
  it('returns the last non-empty trimmed line', () => {
    expect(lastLineOf('foo\n  bar  \n\n')).toBe('bar')
  })
  it('returns empty string for blank input', () => {
    expect(lastLineOf('\n  \n')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/attention/queue.test.ts`
Expected: FAIL — cannot find module `./queue`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/attention/queue.ts
import type { AttentionState } from './detect'

export interface AttentionItem {
  terminalId: string
  state: AttentionState
  lastLine: string
  ts: number
}

// Insert or replace the item for a terminal, keeping the list newest-first.
export function upsertItem(queue: AttentionItem[], item: AttentionItem): AttentionItem[] {
  const rest = queue.filter((q) => q.terminalId !== item.terminalId)
  return [item, ...rest].sort((a, b) => b.ts - a.ts)
}

export function removeItem(queue: AttentionItem[], terminalId: string): AttentionItem[] {
  return queue.filter((q) => q.terminalId !== terminalId)
}

// The last non-empty line of an output tail — the queue/notification snippet.
export function lastLineOf(tail: string): string {
  const lines = tail.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/attention/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/attention/queue.ts src/renderer/src/attention/queue.test.ts
git commit -m "feat(attention): attention queue helpers"
```

---

## Task 4: Notification titles (`notify.ts`)

**Files:**
- Create: `src/renderer/src/attention/notify.ts`
- Test: `src/renderer/src/attention/notify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/attention/notify.test.ts
import { describe, it, expect } from 'vitest'
import { notifTitle } from './notify'

describe('notifTitle', () => {
  it('phrases waiting-input as a question for the user', () => {
    expect(notifTitle('waiting-input', 'claude')).toBe('claude čeka tvoj odgovor')
  })
  it('phrases done as finished', () => {
    expect(notifTitle('done', 'tests')).toBe('tests je gotov')
  })
  it('phrases error as a crash', () => {
    expect(notifTitle('error', 'codex')).toBe('codex je pao')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/attention/notify.test.ts`
Expected: FAIL — cannot find module `./notify`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/attention/notify.ts
import type { AttentionState } from './detect'

// Human-facing OS-notification title for a terminal entering an attention state.
export function notifTitle(state: AttentionState, name: string): string {
  if (state === 'waiting-input') return `${name} čeka tvoj odgovor`
  if (state === 'error') return `${name} je pao`
  return `${name} je gotov`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/attention/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/attention/notify.ts src/renderer/src/attention/notify.test.ts
git commit -m "feat(attention): notification title strings"
```

---

## Task 5: Store helpers (`isUnderReview`, `terminalPath`)

**Files:**
- Modify: `src/renderer/src/store.ts` (append at the end, after `featureIdOfTerminal`)
- Test: `src/renderer/src/store.test.ts` (append a new describe block)

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/store.test.ts`:

```ts
import { isUnderReview, terminalPath } from './store'
import { addGroup as addG, addTerminal as addT } from './store'

describe('attention store helpers', () => {
  // Build: project "p" › feature "general" › terminals origin + reviewer(origin).
  function withReviewer() {
    let s = addG(createInitialState(), 'p', '/tmp')
    const fid = s.activeFeatureId!
    s = addT(s, fid, { id: 'origin', name: 'impl', kind: 'claude' })
    s = addT(s, fid, {
      id: 'rev', name: 'review: codex', kind: 'codex',
      review: { originTerminalId: 'origin', phase: 'impl', round: 1, maxRounds: 5, reviewDir: '/x' }
    })
    return s
  }

  it('isUnderReview is true for a reviewer and its origin', () => {
    const s = withReviewer()
    expect(isUnderReview(s, 'rev')).toBe(true)
    expect(isUnderReview(s, 'origin')).toBe(true)
  })
  it('isUnderReview is false for an unrelated terminal', () => {
    let s = withReviewer()
    s = addT(s, s.activeFeatureId!, { id: 'solo', name: 'solo', kind: 'claude' })
    expect(isUnderReview(s, 'solo')).toBe(false)
  })
  it('terminalPath renders Project › Feature › Terminal', () => {
    const s = withReviewer()
    expect(terminalPath(s, 'origin')).toBe('p › general › impl')
  })
  it('terminalPath is empty for an unknown id', () => {
    expect(terminalPath(createInitialState(), 'nope')).toBe('')
  })
})
```

> Note: `createInitialState` is already imported at the top of `store.test.ts`. If
> `addGroup`/`addTerminal` are already imported there, drop the extra alias import
> line and use the existing names instead of `addG`/`addT`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: FAIL — `isUnderReview`/`terminalPath` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/renderer/src/store.ts`:

```ts
// A terminal the review loop owns: a reviewer (has a review link) or an origin
// some active reviewer points at. Attention routing skips these — review status
// already signals them.
export const isUnderReview = (s: AppState, id: string): boolean => {
  const t = getTerminalById(s, id)
  if (t?.review) return true
  return allTerminals(s).some((x) => x.review?.originTerminalId === id)
}

// "Project › Feature › Terminal" label for a terminal id; '' if not found.
export function terminalPath(s: AppState, id: string): string {
  for (const g of s.workspace.groups)
    for (const f of g.features) {
      const t = f.terminals.find((t) => t.id === id)
      if (t) return `${g.name} › ${f.name} › ${t.name}`
    }
  return ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(attention): store helpers isUnderReview + terminalPath"
```

---

## Task 6: Tail registry (`tailRegistry.ts`)

**Files:**
- Create: `src/renderer/src/attention/tailRegistry.ts`
- Test: `src/renderer/src/attention/tailRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/attention/tailRegistry.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { registerTail, unregisterTail, readTail, readXtermTail, type TermLike } from './tailRegistry'

describe('registry', () => {
  beforeEach(() => { unregisterTail('t1') })
  it('reads from a registered reader', () => {
    registerTail('t1', () => 'hello')
    expect(readTail('t1')).toBe('hello')
  })
  it('returns empty string for an unknown id', () => {
    expect(readTail('missing')).toBe('')
  })
  it('returns empty string when a reader throws', () => {
    registerTail('t1', () => { throw new Error('disposed') })
    expect(readTail('t1')).toBe('')
  })
  it('stops reading after unregister', () => {
    registerTail('t1', () => 'x')
    unregisterTail('t1')
    expect(readTail('t1')).toBe('')
  })
})

describe('readXtermTail', () => {
  // Fake the slice of xterm's buffer API we use.
  function fakeTerm(lines: string[], cursorY: number): TermLike {
    return {
      buffer: { active: {
        baseY: 0, cursorY, length: lines.length,
        getLine: (i: number) => (lines[i] === undefined ? undefined : { translateToString: () => lines[i] }),
      } },
    }
  }
  it('returns the last N lines up to the cursor row', () => {
    const term = fakeTerm(['a', 'b', 'c', 'd'], 3)
    expect(readXtermTail(term, 2)).toBe('c\nd')
  })
  it('clamps to the start of the buffer', () => {
    const term = fakeTerm(['a', 'b'], 1)
    expect(readXtermTail(term, 10)).toBe('a\nb')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/attention/tailRegistry.test.ts`
Expected: FAIL — cannot find module `./tailRegistry`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/attention/tailRegistry.ts

// Map of terminal id → a function returning that terminal's recent output tail.
// TerminalView registers a reader over its live xterm buffer on mount; the
// attention hook reads it when the terminal goes idle. Decouples the hook from
// xterm instances without buffering output a second time in the main process.
const readers = new Map<string, () => string>()

export function registerTail(id: string, read: () => string): void { readers.set(id, read) }
export function unregisterTail(id: string): void { readers.delete(id) }

export function readTail(id: string): string {
  const r = readers.get(id)
  if (!r) return ''
  try { return r() } catch { return '' }
}

// The minimal slice of xterm's API readXtermTail depends on (keeps it testable).
export interface TermLike {
  buffer: { active: {
    baseY: number
    cursorY: number
    length: number
    getLine(i: number): { translateToString(trimRight?: boolean): string } | undefined
  } }
}

// Last `lines` buffer rows ending at the cursor row, joined as plain text.
export function readXtermTail(term: TermLike, lines: number): string {
  const buf = term.buffer.active
  const end = buf.baseY + buf.cursorY
  const start = Math.max(0, end - lines + 1)
  const out: string[] = []
  for (let i = start; i <= end; i++) {
    const ln = buf.getLine(i)
    if (ln) out.push(ln.translateToString(true))
  }
  return out.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/attention/tailRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/attention/tailRegistry.ts src/renderer/src/attention/tailRegistry.test.ts
git commit -m "feat(attention): terminal output tail registry"
```

---

## Task 7: Sound (`sound.ts`)

**Files:**
- Create: `src/renderer/src/attention/sound.ts`
- Test: `src/renderer/src/attention/sound.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/attention/sound.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { isMuted, setMuted, beep } from './sound'

describe('mute persistence', () => {
  beforeEach(() => localStorage.clear())
  it('defaults to not muted', () => {
    expect(isMuted()).toBe(false)
  })
  it('round-trips the muted flag', () => {
    setMuted(true)
    expect(isMuted()).toBe(true)
    setMuted(false)
    expect(isMuted()).toBe(false)
  })
})

describe('beep', () => {
  it('does not throw when no AudioContext is available (jsdom)', () => {
    expect(() => beep('done')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/attention/sound.test.ts`
Expected: FAIL — cannot find module `./sound`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/attention/sound.ts
import type { AttentionState } from './detect'

const KEY = 'attentionMuted'

export function isMuted(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export function setMuted(muted: boolean): void {
  try { localStorage.setItem(KEY, muted ? '1' : '0') } catch { /* ignore */ }
}

// Short Web Audio beep — a lower tone for errors. No-op when muted or when the
// browser blocks/omits AudioContext (e.g. autoplay policy, jsdom in tests).
export function beep(state: AttentionState): void {
  if (isMuted()) return
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = state === 'error' ? 220 : 660
    osc.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.05, ctx.currentTime)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    osc.onended = () => { try { void ctx.close() } catch { /* ignore */ } }
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/attention/sound.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/attention/sound.ts src/renderer/src/attention/sound.test.ts
git commit -m "feat(attention): mute-aware Web Audio beep"
```

---

## Task 8: Main notifier (`notifications.ts`)

**Files:**
- Create: `src/main/notifications.ts`
- Test: `src/main/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/notifications.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createNotifier, type NotificationLike } from './notifications'

function fakeNotification(): NotificationLike & { clickHandlers: Array<() => void>; shown: boolean } {
  return {
    shown: false,
    clickHandlers: [],
    on(_e, cb) { this.clickHandlers.push(cb) },
    show() { this.shown = true },
  }
}

describe('createNotifier', () => {
  it('creates, wires click, and shows a notification', () => {
    const n = fakeNotification()
    const onClick = vi.fn()
    const notifier = createNotifier({ isSupported: () => true, create: () => n, onClick })
    notifier.show({ key: 't1', title: 'hi', body: 'there' })
    expect(n.shown).toBe(true)
    n.clickHandlers.forEach((cb) => cb())
    expect(onClick).toHaveBeenCalledWith('t1')
  })
  it('does nothing when notifications are unsupported', () => {
    const create = vi.fn()
    const notifier = createNotifier({ isSupported: () => false, create, onClick: vi.fn() })
    notifier.show({ key: 't1', title: 'hi', body: 'there' })
    expect(create).not.toHaveBeenCalled()
  })
  it('swallows a constructor error', () => {
    const notifier = createNotifier({
      isSupported: () => true,
      create: () => { throw new Error('boom') },
      onClick: vi.fn(),
    })
    expect(() => notifier.show({ key: 't1', title: 'x', body: 'y' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/notifications.test.ts`
Expected: FAIL — cannot find module `./notifications`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/notifications.ts

// The slice of an Electron Notification we use — injected so this module is
// testable without Electron (mirrors createBusyTracker / createReviewWatcher).
export interface NotificationLike {
  show(): void
  on(event: 'click', cb: () => void): void
}

export interface NotifierDeps {
  isSupported: () => boolean
  create: (opts: { title: string; body: string }) => NotificationLike
  onClick: (key: string) => void
}

export interface NotifyArgs { key: string; title: string; body: string }

export function createNotifier(deps: NotifierDeps) {
  return {
    show({ key, title, body }: NotifyArgs): void {
      if (!deps.isSupported()) return
      try {
        const n = deps.create({ title, body })
        n.on('click', () => deps.onClick(key))
        n.show()
      } catch { /* notifications are best-effort */ }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications.ts src/main/notifications.test.ts
git commit -m "feat(attention): main-process notifier factory"
```

---

## Task 9: IPC plumbing (no new test — typecheck only)

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`

- [ ] **Step 1: Add the channels**

In `src/shared/ipc.ts`, add two entries to the `IPC` object (before the closing `}`):

```ts
  notifyShow: 'notify:show',
  notificationClick: 'notification:click'
```

- [ ] **Step 2: Extend the API type**

In `src/shared/api.ts`, add to the `OrchestrixApi` interface (after `captureAgentSession`):

```ts
  showNotification(opts: { key: string; title: string; body: string }): void
  onNotificationClick(cb: (key: string) => void): () => void
```

- [ ] **Step 3: Implement in preload**

In `src/preload/index.ts`, add to the `api` object (after `captureAgentSession`):

```ts
  showNotification: (opts) => ipcRenderer.send(IPC.notifyShow, opts),
  onNotificationClick: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { key: string }) => cb(p.key)
    ipcRenderer.on(IPC.notificationClick, listener)
    return () => ipcRenderer.removeListener(IPC.notificationClick, listener)
  },
```

- [ ] **Step 4: Wire the notifier in main**

In `src/main/ipc.ts`:

1. Add `Notification` to the existing electron import (line 2):

```ts
import { ipcMain, BrowserWindow, dialog, shell, Notification } from 'electron'
```

2. Add the import near the other local imports (e.g. after the `createReviewWatcher` import):

```ts
import { createNotifier } from './notifications'
```

3. Inside `registerIpc`, after the `reviewWatcher` wiring (around line 105), add:

```ts
  // Native OS notification when an agent needs the user. Click focuses the window
  // and tells the renderer which terminal to jump to (key === terminalId).
  const notifier = createNotifier({
    isSupported: () => Notification.isSupported(),
    create: ({ title, body }) => new Notification({ title, body }),
    onClick: (key) => {
      const win = getWin()
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
      send(IPC.notificationClick, { key })
    }
  })
  ipcMain.on(IPC.notifyShow, (_e, p: { key: string; title: string; body: string }) => notifier.show(p))
```

- [ ] **Step 5: Verify typecheck + existing tests still pass**

Run: `npm run typecheck && npx vitest run src/main/notifications.test.ts`
Expected: typecheck clean; notifier test still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(attention): notify IPC channels + main wiring"
```

---

## Task 10: Per-terminal dot (`AttentionDot.tsx`)

**Files:**
- Create: `src/renderer/src/components/AttentionDot.tsx`
- Test: `src/renderer/src/components/AttentionDot.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/src/components/AttentionDot.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AttentionDot } from './AttentionDot'

describe('AttentionDot', () => {
  it('renders nothing when there is no attention', () => {
    const { container } = render(<AttentionDot state={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('renders an amber dot for waiting-input', () => {
    render(<AttentionDot state="waiting-input" />)
    expect(screen.getByTestId('attn-waiting')).toBeInTheDocument()
  })
  it('renders a blue dot for done', () => {
    render(<AttentionDot state="done" />)
    expect(screen.getByTestId('attn-done')).toBeInTheDocument()
  })
  it('renders a red dot for error', () => {
    render(<AttentionDot state="error" />)
    expect(screen.getByTestId('attn-error')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/AttentionDot.test.tsx`
Expected: FAIL — cannot find module `./AttentionDot`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/renderer/src/components/AttentionDot.tsx
import type { AttentionState } from '../attention/detect'

// A small status dot shown next to a terminal that needs the user. Distinct
// palette from ReviewStatusDot; the two never co-occur (review terminals are
// skipped by attention routing).
export function AttentionDot({ state }: { state: AttentionState | undefined }) {
  if (!state) return null
  if (state === 'waiting-input')
    return <span data-testid="attn-waiting" title="Čeka tvoj odgovor" className="shrink-0 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
  if (state === 'error')
    return <span data-testid="attn-error" title="Pao s greškom" className="shrink-0 h-2 w-2 rounded-full bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)]" />
  return <span data-testid="attn-done" title="Gotov — čeka te" className="shrink-0 h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.7)]" />
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/AttentionDot.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AttentionDot.tsx src/renderer/src/components/AttentionDot.test.tsx
git commit -m "feat(attention): per-terminal AttentionDot"
```

---

## Task 11: Icons (`BellIcon`, `SpeakerIcon`, `SpeakerMutedIcon`)

**Files:**
- Modify: `src/renderer/src/components/icons.tsx` (append the three components)
- Test: `src/renderer/src/components/icons.test.tsx` (append assertions)

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/components/icons.test.tsx` a test that renders the new icons. (The file already imports `render`/`screen` and the icon set — add `BellIcon, SpeakerIcon, SpeakerMutedIcon` to its import from `./icons`.)

```tsx
describe('attention icons', () => {
  it('renders the bell icon', () => {
    render(<BellIcon />)
    expect(screen.getByTestId('icon-bell')).toBeInTheDocument()
  })
  it('renders the speaker icon', () => {
    render(<SpeakerIcon />)
    expect(screen.getByTestId('icon-speaker')).toBeInTheDocument()
  })
  it('renders the muted speaker icon', () => {
    render(<SpeakerMutedIcon />)
    expect(screen.getByTestId('icon-speaker-muted')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/icons.test.tsx`
Expected: FAIL — `BellIcon` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/renderer/src/components/icons.tsx`:

```tsx
export function BellIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-bell" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10.5 20a1.5 1.5 0 0 0 3 0" />
    </svg>
  )
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-speaker" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
    </svg>
  )
}

export function SpeakerMutedIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-speaker-muted" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9l4 6M20 9l-4 6" />
    </svg>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/icons.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/icons.tsx src/renderer/src/components/icons.test.tsx
git commit -m "feat(attention): bell + speaker icons"
```

---

## Task 12: Attention bell + queue popover (`AttentionBell.tsx`)

**Files:**
- Create: `src/renderer/src/components/AttentionBell.tsx`
- Test: `src/renderer/src/components/AttentionBell.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/src/components/AttentionBell.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AttentionBell, type AttentionBellItem } from './AttentionBell'

const items: AttentionBellItem[] = [
  { terminalId: 'a', state: 'waiting-input', lastLine: 'Proceed? (y/n)', path: 'p › f › claude' },
  { terminalId: 'b', state: 'error', lastLine: 'exit 1', path: 'p › f › codex' },
]
const base = {
  items, muted: false,
  onSelect: vi.fn(), onClear: vi.fn(), onClearAll: vi.fn(), onToggleMute: vi.fn(),
}

describe('AttentionBell', () => {
  it('shows the count of waiting terminals', () => {
    render(<AttentionBell {...base} />)
    expect(screen.getByLabelText(/2 terminal/i)).toBeInTheDocument()
  })
  it('opens the popover and lists items by path', () => {
    render(<AttentionBell {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    expect(screen.getByText('p › f › claude')).toBeInTheDocument()
    expect(screen.getByText('p › f › codex')).toBeInTheDocument()
  })
  it('selecting an item calls onSelect with its terminal id', () => {
    const onSelect = vi.fn()
    render(<AttentionBell {...base} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    fireEvent.click(screen.getByText('p › f › claude'))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
  it('clear-all calls onClearAll', () => {
    const onClearAll = vi.fn()
    render(<AttentionBell {...base} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(onClearAll).toHaveBeenCalled()
  })
  it('mute toggle calls onToggleMute', () => {
    const onToggleMute = vi.fn()
    render(<AttentionBell {...base} onToggleMute={onToggleMute} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    fireEvent.click(screen.getByRole('button', { name: /mute|unmute/i }))
    expect(onToggleMute).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/AttentionBell.test.tsx`
Expected: FAIL — cannot find module `./AttentionBell`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/renderer/src/components/AttentionBell.tsx
import { useState } from 'react'
import type { AttentionState } from '../attention/detect'
import { AttentionDot } from './AttentionDot'
import { BellIcon, SpeakerIcon, SpeakerMutedIcon, TrashIcon } from './icons'

export interface AttentionBellItem {
  terminalId: string
  state: AttentionState
  lastLine: string
  path: string
}

// Global "who needs me" control: a bell with a count at the top of the sidebar,
// opening a queue popover. Cross-project — it surfaces agents in any project.
export function AttentionBell(props: {
  items: AttentionBellItem[]
  muted: boolean
  onSelect: (terminalId: string) => void
  onClear: (terminalId: string) => void
  onClearAll: () => void
  onToggleMute: () => void
}) {
  const { items, muted, onSelect, onClear, onClearAll, onToggleMute } = props
  const [open, setOpen] = useState(false)
  const count = items.length

  return (
    <div className="relative">
      <button
        aria-label={`Attention — ${count} terminal(s) waiting`}
        onClick={() => setOpen((o) => !o)}
        className={`relative flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-sm transition ${
          count > 0 ? 'text-amber-300 hover:bg-hover' : 'text-fg-muted hover:bg-hover'}`}
      >
        <BellIcon className="shrink-0" />
        <span className="flex-1 text-left truncate">Pažnja</span>
        {count > 0 && (
          <span className="shrink-0 min-w-5 px-1.5 text-center rounded-full bg-amber-400 text-[11px] font-semibold text-black">
            {count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-30 mt-1 rounded-md border border-line bg-panel shadow-lg overflow-hidden">
            {count === 0 ? (
              <div className="px-3 py-3 text-sm text-fg-muted">Niko te ne čeka.</div>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {items.map((it) => (
                  <li key={it.terminalId} className="group flex items-center gap-2 px-2 py-1.5 hover:bg-hover">
                    <AttentionDot state={it.state} />
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => { onSelect(it.terminalId); setOpen(false) }}
                    >
                      <div className="truncate text-sm text-fg-bright">{it.path}</div>
                      {it.lastLine && <div className="truncate text-xs text-fg-muted">{it.lastLine}</div>}
                    </button>
                    <button
                      aria-label={`Clear ${it.path}`}
                      title="Ukloni iz liste"
                      onClick={() => onClear(it.terminalId)}
                      className="opacity-0 group-hover:opacity-100 px-1 text-fg-muted hover:text-danger transition"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
              <button
                aria-label={muted ? 'Unmute' : 'Mute'}
                title={muted ? 'Uključi zvuk' : 'Isključi zvuk'}
                onClick={onToggleMute}
                className="px-1 text-fg-muted hover:text-fg transition"
              >
                {muted ? <SpeakerMutedIcon /> : <SpeakerIcon />}
              </button>
              <button
                onClick={() => { onClearAll(); setOpen(false) }}
                disabled={count === 0}
                className="px-2 py-0.5 text-xs rounded text-fg-muted hover:text-fg disabled:opacity-40 transition"
              >
                Clear all
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/AttentionBell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AttentionBell.tsx src/renderer/src/components/AttentionBell.test.tsx
git commit -m "feat(attention): AttentionBell queue popover"
```

---

## Task 13: The hook (`useAttention.ts`) — wiring, no unit test

**Files:**
- Create: `src/renderer/src/attention/useAttention.ts`

This wires the pure modules to the live event streams. It is verified by
typecheck here and by the final manual smoke test — NOT by a unit test (matching
`useReview.ts`).

- [ ] **Step 1: Write the implementation**

```ts
// src/renderer/src/attention/useAttention.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState } from '../store'
import { getTerminalById, allTerminals, isUnderReview, setActiveTerminal } from '../store'
import { readTail } from './tailRegistry'
import { classifyIdle, type AttentionState } from './detect'
import { decideOnIdle, decideOnExit } from './decide'
import { upsertItem, removeItem, lastLineOf, type AttentionItem } from './queue'
import { notifTitle } from './notify'
import { beep, isMuted, setMuted } from './sound'

// Restored agents settle (resume redraw → idle) right after launch; ignore idle/
// exit events during this window so a restart doesn't fire a storm of notifications.
const STARTUP_GRACE_MS = 4000

export function useAttention(state: AppState, apply: (fn: (s: AppState) => AppState) => void) {
  const [attention, setAttentionMap] = useState<Record<string, AttentionState | undefined>>({})
  const [queue, setQueue] = useState<AttentionItem[]>([])
  const [muted, setMutedState] = useState<boolean>(() => isMuted())

  // Refs so the stable event handlers always read current values without
  // re-subscribing (which would churn ipcRenderer listeners and risk dropping
  // transitions). stateRef is refreshed every render.
  const stateRef = useRef(state)
  stateRef.current = state
  const attentionRef = useRef<Record<string, AttentionState | undefined>>({})
  const focusedRef = useRef<boolean>(typeof document !== 'undefined' ? document.hasFocus() : true)
  const startedAt = useRef<number>(Date.now())

  const [focused, setFocused] = useState<boolean>(focusedRef.current)
  useEffect(() => {
    const onFocus = () => { focusedRef.current = true; setFocused(true) }
    const onBlur = () => { focusedRef.current = false; setFocused(false) }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur) }
  }, [])

  const clearInternal = useCallback((id: string) => {
    if (attentionRef.current[id] === undefined) return
    const next = { ...attentionRef.current }; delete next[id]
    attentionRef.current = next
    setAttentionMap(next)
    setQueue((q) => removeItem(q, id))
  }, [])

  const fire = useCallback((id: string, st: AttentionState, lastLine: string) => {
    if (attentionRef.current[id] === st) return // dedup: one alert per entry into a state
    const next = { ...attentionRef.current, [id]: st }
    attentionRef.current = next
    setAttentionMap(next)
    setQueue((q) => upsertItem(q, { terminalId: id, state: st, lastLine, ts: Date.now() }))
    const t = getTerminalById(stateRef.current, id)
    window.orchestrix.showNotification({ key: id, title: notifTitle(st, t?.name ?? 'terminal'), body: lastLine })
    beep(st)
  }, [])

  const ctxFor = (id: string) => {
    const s = stateRef.current
    const t = getTerminalById(s, id)
    return {
      term: t,
      ctx: {
        isAgent: t?.kind === 'claude' || t?.kind === 'codex',
        underReview: isUnderReview(s, id),
        activeAndFocused: focusedRef.current && s.activeTerminalId === id,
      },
    }
  }

  const handleBusy = useCallback((id: string, busy: boolean) => {
    if (busy) { clearInternal(id); return } // resumed → previous attention is stale
    if (Date.now() - startedAt.current < STARTUP_GRACE_MS) return
    const { term, ctx } = ctxFor(id)
    if (!term) return
    const tail = readTail(id)
    const st = decideOnIdle(classifyIdle(tail), ctx)
    if (st) fire(id, st, lastLineOf(tail))
  }, [clearInternal, fire])

  const handleExit = useCallback((id: string, code: number) => {
    if (Date.now() - startedAt.current < STARTUP_GRACE_MS) return
    const { term, ctx } = ctxFor(id)
    if (!term) return
    const st = decideOnExit(code, ctx)
    if (st) fire(id, st, `exit ${code}`)
  }, [fire])

  const handleNotificationClick = useCallback((key: string) => {
    apply((s) => setActiveTerminal(s, key))
    clearInternal(key)
  }, [apply, clearInternal])

  const clear = useCallback((id: string) => clearInternal(id), [clearInternal])
  const clearAll = useCallback(() => {
    for (const id of Object.keys(attentionRef.current)) clearInternal(id)
  }, [clearInternal])
  const toggleMute = useCallback(() => {
    const m = !isMuted(); setMuted(m); setMutedState(m)
  }, [])

  // Clear the attention for the terminal you're actively looking at.
  useEffect(() => {
    if (focused && state.activeTerminalId) clearInternal(state.activeTerminalId)
  }, [focused, state.activeTerminalId, clearInternal])

  // Prune entries for terminals that no longer exist (deleted/closed).
  useEffect(() => {
    const ids = new Set(allTerminals(state).map((t) => t.id))
    for (const id of Object.keys(attentionRef.current)) if (!ids.has(id)) clearInternal(id)
  }, [state.workspace, clearInternal])

  return { attention, queue, muted, handleBusy, handleExit, handleNotificationClick, clear, clearAll, toggleMute }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: clean (no errors). If `setActiveTerminal` / `isUnderReview` import errors,
confirm they are exported from `store.ts` (Task 5).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/attention/useAttention.ts
git commit -m "feat(attention): useAttention hook wiring pure modules to pty streams"
```

---

## Task 14: Render the dot + bell in the Sidebar

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`

- [ ] **Step 1: Add imports**

At the top of `Sidebar.tsx`, add:

```ts
import { AttentionDot } from './AttentionDot'
import { AttentionBell, type AttentionBellItem } from './AttentionBell'
import type { AttentionState } from '../attention/detect'
```

- [ ] **Step 2: Add props to the Sidebar prop type**

In the `props` object type, after `onPendingRenameConsumed?: () => void`, add:

```ts
  attention: Record<string, AttentionState | undefined>
  attentionItems: AttentionBellItem[]
  attentionMuted: boolean
  onAttentionSelect: (terminalId: string) => void
  onAttentionClear: (terminalId: string) => void
  onAttentionClearAll: () => void
  onToggleAttentionMute: () => void
```

And add them to the destructure block (the `const { ... } = props`):

```ts
    attention, attentionItems, attentionMuted, onAttentionSelect, onAttentionClear, onAttentionClearAll, onToggleAttentionMute
```

- [ ] **Step 3: Host the bell at the top of the sidebar**

Immediately inside the outer sidebar `<div style={{ width }} ...>`, BEFORE the
`<div className="flex-1 overflow-y-auto py-1" data-groups ...>` block, insert:

```tsx
      <div className="p-2 border-b border-line">
        <AttentionBell
          items={attentionItems}
          muted={attentionMuted}
          onSelect={onAttentionSelect}
          onClear={onAttentionClear}
          onClearAll={onAttentionClearAll}
          onToggleMute={onToggleAttentionMute}
        />
      </div>
```

- [ ] **Step 4: Render the per-terminal dot**

In the terminal row, immediately after `<ReviewStatusDot status={reviewStatus[t.id]} />`, add:

```tsx
                              <AttentionDot state={attention[t.id]} />
```

- [ ] **Step 5: Verify typecheck + Sidebar tests still pass**

Run: `npm run typecheck && npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: typecheck clean. If `Sidebar.test.tsx` fails because the new required
props are missing from its render call, add them to the test's base props:

```ts
  attention: {}, attentionItems: [], attentionMuted: false,
  onAttentionSelect: () => {}, onAttentionClear: () => {},
  onAttentionClearAll: () => {}, onToggleAttentionMute: () => {},
```

Re-run until PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(attention): sidebar attention dot + bell host"
```

---

## Task 15: Render the dot in the TabBar

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`

- [ ] **Step 1: Add imports + prop**

At the top, add:

```ts
import { AttentionDot } from './AttentionDot'
import type { AttentionState } from '../attention/detect'
```

Add to the `TabBar` prop type (after `busy: Record<string, boolean>`):

```ts
  attention: Record<string, AttentionState | undefined>
```

Add `attention` to the destructured parameter list at the top of the function
signature (the `{ terminals, activeId, liveAgents, onSelect, onClose, reviewStatus, busy }` list).

- [ ] **Step 2: Render the dot**

Immediately after `<ReviewStatusDot status={reviewStatus[t.id]} />`, add:

```tsx
            <AttentionDot state={attention[t.id]} />
```

- [ ] **Step 3: Verify typecheck + TabBar tests**

Run: `npm run typecheck && npx vitest run src/renderer/src/components/TabBar.test.tsx`
Expected: typecheck clean. If `TabBar.test.tsx` fails for a missing `attention`
prop, add `attention={{}}` (or `attention: {}` in its base props) to the render
call. Re-run until PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/TabBar.tsx src/renderer/src/components/TabBar.test.tsx
git commit -m "feat(attention): tab bar attention dot"
```

---

## Task 16: Wire `useAttention` into `App.tsx`

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add imports**

Add `terminalPath` to the existing `./store` import list. Add:

```ts
import { useAttention } from './attention/useAttention'
```

- [ ] **Step 2: Instantiate the hook + subscribe**

After the review wiring (the two `useEffect`s for `review.handleFsChanged` /
`review.handleBusy`, around line 76), add:

```ts
  const attention = useAttention(state, apply)
  useEffect(() => window.orchestrix.onPtyBusy(attention.handleBusy), [attention.handleBusy])
  useEffect(() => window.orchestrix.onPtyExit(attention.handleExit), [attention.handleExit])
  useEffect(() => window.orchestrix.onNotificationClick(attention.handleNotificationClick), [attention.handleNotificationClick])
```

- [ ] **Step 3: Build enriched queue items**

Near the other derived values (e.g. just before `return (`), add:

```ts
  const attentionItems = attention.queue.map((q) => ({
    terminalId: q.terminalId, state: q.state, lastLine: q.lastLine, path: terminalPath(state, q.terminalId),
  }))
```

- [ ] **Step 4: Pass props to Sidebar**

Add to the `<Sidebar ... />` props:

```tsx
        attention={attention.attention}
        attentionItems={attentionItems}
        attentionMuted={attention.muted}
        onAttentionSelect={(id) => apply((s) => (isHidden(s, id) ? showTerminal(s, id) : setActiveTerminal(s, id)))}
        onAttentionClear={attention.clear}
        onAttentionClearAll={attention.clearAll}
        onToggleAttentionMute={attention.toggleMute}
```

- [ ] **Step 5: Pass prop to TabBar**

Add to the `<TabBar ... />` props:

```tsx
          attention={attention.attention}
```

- [ ] **Step 6: Verify typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(attention): wire useAttention into App (sidebar + tab bar + notifications)"
```

---

## Task 17: Final verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full automated verification**

Run: `npm test && npm run typecheck`
Expected: ALL tests PASS, typecheck clean. Fix any failure before continuing.

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`

Verify, in a project with a real `claude` (or `codex`) on PATH:

1. Launch an agent, give it a task, switch to ANOTHER terminal/tab (so the agent
   is backgrounded), and blur the window. When the agent finishes → OS
   notification fires, a beep plays, a blue dot appears on its sidebar row + tab,
   and the bell count increments.
2. Trigger a permission prompt in the agent (e.g. an action that asks y/n) →
   amber dot + "čeka tvoj odgovor" notification.
3. Click the OS notification → window focuses and that terminal becomes active;
   its dot and bell entry clear.
4. Open the bell popover → the waiting terminals are listed by
   `Project › Feature › Terminal`; clicking one jumps to it and clears it;
   "Clear all" empties the list; the speaker toggle silences/▶ the beep
   (persists across restart).
5. Make an agent process exit non-zero while backgrounded → red dot + "je pao".
   A clean exit (`exit 0`) produces NO alert.
6. While you are actively viewing a focused agent terminal, its finishing
   produces NO notification (suppressed) — the dot stays clear.
7. Start a cross-agent review → the reviewer/origin show review dots only, NO
   attention dots (review owns them).
8. Restart the app with several agents open → no notification storm in the first
   few seconds (startup grace).

- [ ] **Step 3: Finalize the branch**

When the smoke test passes, this is the point to hand off to
`superpowers:finishing-a-development-branch` (merge `feature/attention-routing`
into `master` per the project's git workflow — `--no-ff`, confirm before pushing).

---

## Self-Review Notes (completed by plan author)

- **Spec coverage:** triggers (waiting-input/done/error) → Tasks 1,2,13; four
  channels — OS notification (Tasks 8,9,13), sound (Task 7,13), sidebar dot
  (Tasks 10,14,15), queue (Tasks 3,12,16); suppression rules 1–6 → Task 2 +
  hook (Task 13); rule 7 (idle = existing busy signal) → handled by reusing
  `pty:busy`; rule 8 (startup grace) → Task 13; review boundary → Task 5 +
  decide; notification click-to-focus → Tasks 8,9,13,16.
- **Type consistency:** `AttentionState` defined once in `detect.ts`, imported
  everywhere; `AttentionItem` from `queue.ts`; `AttentionBellItem` from
  `AttentionBell.tsx`; `DecideCtx` from `decide.ts`. Handler names
  (`handleBusy`, `handleExit`, `handleNotificationClick`, `clear`, `clearAll`,
  `toggleMute`) match between hook and App.
- **No placeholders:** every step ships complete code/commands.
</content>

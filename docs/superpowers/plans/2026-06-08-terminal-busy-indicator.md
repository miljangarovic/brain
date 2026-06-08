# Terminal busy indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live spinner on a terminal's tab and sidebar row while it is producing output, so the user can see which terminals are busy.

**Architecture:** The main process tracks "is producing output" per terminal via a debounced `busyTracker` fed by PTY data, and emits a `pty:busy` IPC event only on idle↔busy transitions. The renderer keeps a `Record<id, boolean>` busy map and swaps the kind icon for the existing `SpinnerIcon` in `TabBar` and `Sidebar`.

**Tech Stack:** Electron (main/preload/renderer), React, TypeScript, Vitest (jsdom + fake timers), Tailwind.

---

### Task 1: busyTracker (main)

**Files:**
- Create: `src/main/busyTracker.ts`
- Test: `src/main/busyTracker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/busyTracker.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBusyTracker } from './busyTracker'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createBusyTracker', () => {
  it('emits busy=true once on first output, not again before idle', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    t.touch('a')
    expect(emit.mock.calls).toEqual([['a', true]])
  })

  it('emits busy=false after the idle window elapses', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    emit.mockClear()
    vi.advanceTimersByTime(600)
    expect(emit.mock.calls).toEqual([['a', false]])
  })

  it('re-arms: each touch pushes the idle deadline back', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    vi.advanceTimersByTime(400)
    t.touch('a')
    vi.advanceTimersByTime(400)
    expect(emit).toHaveBeenCalledTimes(1) // still busy
    vi.advanceTimersByTime(200)
    expect(emit).toHaveBeenLastCalledWith('a', false)
  })

  it('goes busy again after having gone idle', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a'); vi.advanceTimersByTime(600)
    emit.mockClear()
    t.touch('a')
    expect(emit.mock.calls).toEqual([['a', true]])
  })

  it('end() while busy emits false and cancels the pending idle timer', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    emit.mockClear()
    t.end('a')
    expect(emit.mock.calls).toEqual([['a', false]])
    vi.advanceTimersByTime(1000)
    expect(emit).toHaveBeenCalledTimes(1) // no spurious emit from old timer
  })

  it('end() while idle emits nothing', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.end('a')
    expect(emit).not.toHaveBeenCalled()
  })

  it('tracks ids independently', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    t.touch('b')
    expect(emit.mock.calls).toEqual([['a', true], ['b', true]])
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/main/busyTracker.test.ts`
Expected: FAIL — cannot resolve `./busyTracker`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/busyTracker.ts
export interface BusyTracker {
  touch(id: string): void  // output arrived → mark busy, (re)arm the idle timer
  end(id: string): void    // pty exited → force idle and drop the timer
}

// Derives a per-terminal "is producing output" flag from a stream of output
// notifications. busy flips on at the first chunk and off after `idleMs` of
// silence. Emits ONLY on transitions so the renderer doesn't churn per chunk.
export function createBusyTracker(
  emit: (id: string, busy: boolean) => void,
  idleMs = 600
): BusyTracker {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const busy = new Set<string>()

  const arm = (id: string): void => {
    const existing = timers.get(id)
    if (existing) clearTimeout(existing)
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      busy.delete(id)
      emit(id, false)
    }, idleMs))
  }

  return {
    touch(id) {
      if (!busy.has(id)) { busy.add(id); emit(id, true) }
      arm(id)
    },
    end(id) {
      const existing = timers.get(id)
      if (existing) { clearTimeout(existing); timers.delete(id) }
      if (busy.delete(id)) emit(id, false)
    }
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/main/busyTracker.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/busyTracker.ts src/main/busyTracker.test.ts
git commit -m "feat(pty): add busyTracker — debounced per-terminal output activity"
```

---

### Task 2: Shared IPC contract + preload

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the channel** — in `src/shared/ipc.ts`, add after `fsChanged: 'fs:changed'` (add a comma to the previous line):

```ts
  fsChanged: 'fs:changed',
  ptyBusy: 'pty:busy'
```

- [ ] **Step 2: Add the API method** — in `src/shared/api.ts`, add after the `onPtyProc` line:

```ts
  onPtyBusy(cb: (id: string, busy: boolean) => void): () => void
```

- [ ] **Step 3: Implement in preload** — in `src/preload/index.ts`, add after the `onPtyProc` block (before `pickFile`):

```ts
  onPtyBusy: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { id: string; busy: boolean }) => cb(p.id, p.busy)
    ipcRenderer.on(IPC.ptyBusy, listener)
    return () => ipcRenderer.removeListener(IPC.ptyBusy, listener)
  },
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (no output).

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts
git commit -m "feat(ipc): add pty:busy channel and onPtyBusy"
```

---

### Task 3: Wire busyTracker into ipc.ts

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Import the tracker** — add to the imports at the top of `src/main/ipc.ts`:

```ts
import { createBusyTracker } from './busyTracker'
```

- [ ] **Step 2: Create the tracker and feed it** — replace the two existing forwarders:

```ts
  ptyManager.onData((id, data) => send(IPC.ptyData, { id, data }))
  ptyManager.onExit((id, code) => send(IPC.ptyExit, { id, code }))
```

with:

```ts
  const busy = createBusyTracker((id, isBusy) => send(IPC.ptyBusy, { id, busy: isBusy }))
  ptyManager.onData((id, data) => { send(IPC.ptyData, { id, data }); busy.touch(id) })
  ptyManager.onExit((id, code) => { send(IPC.ptyExit, { id, code }); busy.end(id) })
```

- [ ] **Step 3: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS (typecheck clean; all existing tests green).

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat(pty): emit pty:busy from data/exit via busyTracker"
```

---

### Task 4: TabBar spinner

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`
- Test: `src/renderer/src/components/TabBar.test.tsx`

- [ ] **Step 1: Write the failing test** — add inside `describe('TabBar', ...)` in `TabBar.test.tsx`, and add `busy: {}` to the existing `reviewProps` object so the current renders keep working:

Change `reviewProps` to:

```ts
const reviewProps = {
  reviewStatus: {},
  onReviewTerminal: noop,
  busy: {},
}
```

Add this test:

```ts
  it('shows a spinner instead of the kind icon while the terminal is busy', () => {
    render(<TabBar terminals={terms} activeId="a" liveAgents={{}}
      onSelect={noop} onClose={noop} {...reviewProps} busy={{ a: true }} />)
    const tab = screen.getAllByRole('tab')[0]
    expect(within(tab).getByTestId('icon-spinner')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/renderer/src/components/TabBar.test.tsx`
Expected: FAIL — `busy` is not a prop / no `icon-spinner` found (and a TS error on the `busy` prop).

- [ ] **Step 3: Implement** — in `TabBar.tsx`:

Add `SpinnerIcon` to the icons import:

```ts
import { TerminalKindIcon, ReviewIcon, SpinnerIcon } from './icons'
```

Add `busy` to the destructured params and the prop type:

```ts
export function TabBar({
  terminals, activeId, liveAgents, onSelect, onClose, reviewStatus, onReviewTerminal, busy
}: {
  terminals: Terminal[]
  activeId: string | null
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
  onReviewTerminal: (id: string, reviewer?: AgentKind) => void
  busy: Record<string, boolean>
}) {
```

Replace the icon line:

```ts
            <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
```

with:

```ts
            {busy[t.id]
              ? <SpinnerIcon className="shrink-0 text-accent" />
              : <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/renderer/src/components/TabBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TabBar.tsx src/renderer/src/components/TabBar.test.tsx
git commit -m "feat(ui): show busy spinner on tabs"
```

---

### Task 5: Sidebar spinner

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Test: `src/renderer/src/components/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test** — first add `busy: {}` to the props object the Sidebar test builds (find where it constructs `Sidebar` props and add the key), then add a test. Example test (adapt the props factory name to the file):

```ts
  it('shows a spinner on a busy terminal row', () => {
    renderSidebar({ busy: { t1: true } }) // however the suite builds props
    const row = document.querySelector('[data-term-id="t1"]') as HTMLElement
    expect(within(row).getByTestId('icon-spinner')).toBeInTheDocument()
  })
```

If the suite renders `<Sidebar {...props} />` inline rather than via a helper, pass `busy={{ <id>: true }}` on that render and assert the spinner inside the matching `[data-term-id]` row.

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: FAIL — `busy` not a prop / no `icon-spinner`.

- [ ] **Step 3: Implement** — in `Sidebar.tsx`:

Add `SpinnerIcon` to the icons import:

```ts
import { TerminalKindIcon, GridIcon, TrashIcon, ReviewIcon, SpinnerIcon } from './icons'
```

Add `busy: Record<string, boolean>` to the props type (next to `liveAgents`) and to the destructuring of `props`.

Replace the icon line (currently `<TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />`) with:

```ts
                              {busy[t.id]
                                ? <SpinnerIcon className="shrink-0 text-accent" />
                                : <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(ui): show busy spinner on sidebar terminal rows"
```

---

### Task 6: Wire busy state into App

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add busy state + subscription** — after the existing `liveAgents` effect (the `onPtyProc` block, ~lines 30-35), add:

```ts
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  useEffect(() => {
    return window.terminaltor.onPtyBusy((id, b) => setBusy((m) => ({ ...m, [id]: b })))
  }, [])
```

- [ ] **Step 2: Pass busy to TabBar** — add the prop to the `<TabBar ... />` element:

```ts
          liveAgents={liveAgents}
          busy={busy}
```

- [ ] **Step 3: Pass busy to Sidebar** — add the prop to the `<Sidebar ... />` element (next to `liveAgents={liveAgents}`):

```ts
        liveAgents={liveAgents}
        busy={busy}
```

- [ ] **Step 4: Verify typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: PASS — typecheck clean, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(ui): track and propagate per-terminal busy state"
```

---

## Self-Review notes

- **Spec coverage:** trigger=output activity (Task 1, 600ms), main-side transitions (Task 1/3), `pty:busy` contract (Task 2), App map + TabBar/Sidebar spinner (Tasks 4-6), tests (Tasks 1/4/5). All covered.
- **Type consistency:** `createBusyTracker(emit, idleMs)`, `BusyTracker.touch/end`, `onPtyBusy(cb: (id, busy) => void)`, `busy: Record<string, boolean>`, `SpinnerIcon` (`data-testid="icon-spinner"`) used consistently across tasks.
- **Edge cases:** `end()` on exit clears spinner (Task 1 test + Task 3 wiring); independent ids (Task 1 test).

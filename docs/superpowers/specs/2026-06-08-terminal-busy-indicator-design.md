# Terminal busy indicator (live activity loader)

## Problem

While an agent (claude/codex) is processing a prompt — or any command is
running — there is no visual signal that the terminal is busy. The user wants an
active loader showing that "something is happening" in a terminal, so they can
tell at a glance which terminals are working, including ones in the background.

## Trigger (what "busy" means)

**Output activity.** A terminal is *busy* whenever it is currently producing
output, and *idle* once its output goes quiet for a short window. This is
agent-agnostic: it lights up for claude/codex while they stream, and also for a
shell running `npm test`, a build, etc.

Rationale: the PTY foreground process name ("node"/"claude") is identical whether
claude is thinking or sitting idle at its prompt, so it cannot distinguish busy
from idle. Output flow can: agents stream while working and fall silent when they
finish and wait for input.

- Idle window: **600 ms** (constant, easily tunable). Trade-off: shorter = faster
  idle detection but flickers during long pauses (e.g. a tool call); longer =
  steadier but slower to clear.

## Approach

Compute busy state in the **main process** and emit only on transitions
(idle→busy, busy→idle). The renderer never sees per-chunk traffic, so the React
tree does not re-render on every byte. This mirrors the existing `pty:proc`
pattern (main tracks, sends only on change).

Rejected alternative: subscribe to `onPtyData` in the renderer and track timers
there — `onPtyData` fires per chunk, which would re-render the whole App on every
byte of output. Too expensive.

## Components & data flow

```
node-pty data ──> PtyManager.onData ──> ipc.ts handler
                                          ├─ send(pty:data)        (existing)
                                          └─ busyTracker.touch(id) (new)
                                                  │  on transition
                                                  ▼
                                          send(pty:busy {id, busy})
                                                  │
                            preload onPtyBusy ──> App busy state ──> TabBar / Sidebar
                                                                       └─ SpinnerIcon vs TerminalKindIcon
PtyManager.onExit ──> ipc.ts handler ──> busyTracker.end(id) ──> send(pty:busy {id,false})
```

### New unit: `src/main/busyTracker.ts`

A small, framework-free, independently testable unit.

```ts
export interface BusyTracker {
  touch(id: string): void  // output arrived → mark busy, (re)arm the idle timer
  end(id: string): void    // pty exited → force idle and drop the timer
}
export function createBusyTracker(
  emit: (id: string, busy: boolean) => void,
  idleMs?: number,          // default 600
): BusyTracker
```

Behavior:
- `touch(id)`: if not already busy, mark busy and `emit(id, true)`. Always clear
  any existing idle timer for `id` and start a fresh one; when it fires, mark
  idle and `emit(id, false)`.
- `end(id)`: clear the timer; if it was busy, `emit(id, false)`. Idempotent.

Depends on: nothing but `setTimeout`/`clearTimeout` (faked in tests).

### `src/main/ipc.ts`

- Create `const busy = createBusyTracker((id, isBusy) => send(IPC.ptyBusy, { id, busy: isBusy }))`.
- In the existing `ptyManager.onData((id, data) => …)` handler, also call `busy.touch(id)`.
- In the existing `ptyManager.onExit((id) => …)` handler, also call `busy.end(id)`.

### Shared contract

- `src/shared/ipc.ts`: add `ptyBusy: 'pty:busy'`.
- `src/shared/api.ts`: add `onPtyBusy(cb: (id: string, busy: boolean) => void): () => void`.
- `src/preload/index.ts`: implement `onPtyBusy` exactly like `onPtyProc`
  (subscribe, return an unsubscribe).

### Renderer

- `src/renderer/src/App.tsx`: `const [busy, setBusy] = useState<Record<string, boolean>>({})`;
  subscribe in an effect: `onPtyBusy((id, b) => setBusy(m => ({ ...m, [id]: b })))`;
  pass `busy` to `TabBar` and `Sidebar`.
- `src/renderer/src/components/TabBar.tsx` and `Sidebar.tsx`: accept
  `busy: Record<string, boolean>` and render at the icon slot:
  `busy[t.id] ? <SpinnerIcon className="shrink-0 text-accent" /> : <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />`.

Reuse the existing `SpinnerIcon` (already `animate-spin`, `currentColor`).
`ReviewStatusDot` is left untouched — review status is a separate concept; an
occasional overlap (both spinning) is acceptable.

## Error handling / edge cases

- PTY exits while busy → `end(id)` emits `busy:false`, so no stuck spinner.
- Rapid output → `touch` emits `true` once; only the idle timer is reset per chunk.
- Hidden/background terminals still emit busy → the sidebar shows their spinner
  (a desired benefit).

## Testing

- `src/main/busyTracker.test.ts` (vitest fake timers):
  - `touch` emits `true` once; a second `touch` before idle does **not** re-emit.
  - after `idleMs` with no touch → emits `false`.
  - `touch` after going idle emits `true` again.
  - `end` while busy emits `false` and clears the timer (no later spurious emit);
    `end` while idle emits nothing.
- `TabBar.test.tsx` / `Sidebar.test.tsx`: with `busy[id] = true`, the row shows
  `icon-spinner`; otherwise the kind icon. (Extend existing tests with a `busy={}`
  default prop so current assertions stay focused.)

## Out of scope (YAGNI)

- Per-agent TUI parsing of the "thinking" state.
- Configurable threshold in the UI.
- Progress percentage / elapsed time.
- Review spinner taking priority over the busy spinner.

## Addendum (2026-06-08): suppress the spinner while typing

Typing into a terminal produces output — the shell echoes keystrokes, and TUI
agents (claude/codex) redraw their input line — which would otherwise flip the
terminal to busy and show the spinner while the user is just typing.

**Behavior:** while the user is typing, no spinner. Decision: *hide while
typing* — if an agent is already working and the user starts typing, the spinner
hides immediately and returns ~`typingMs` after the last keystroke if output
continues.

**Mechanism:** `busyTracker` gains `input(id)`, fed from the `pty:input` handler
in `ipc.ts` (`busy.input(p.id)` alongside `ptyManager.write`). Per terminal:
- `input(id)`: clear the idle timer; if busy → `emit(id, false)` (hide now); enter
  a *typing* state with a `typingMs` timer (default **400 ms**), re-armed on each
  keystroke.
- `touch(id)` while *typing* → ignored (echo is not work).
- typing timer elapses → leave *typing*; the next `touch` resumes normal busy.
- `end(id)` also clears the typing state/timer.

`typingMs` (400 ms) is a tunable constant: shorter = spinner returns faster after
sending a prompt; longer = more reliably swallows fast typing.

Programmatic writes that flow through `pty:input` (e.g. the review relay) also
count as "input" and briefly suppress — acceptable, the agent's subsequent output
re-arms busy after the window.

**Tests:** `busyTracker.test.ts` extended — typing suppresses busy; input while
busy emits `false` and cancels the stale idle timer; busy resumes after the
typing window; each keystroke re-arms the window; typing is per-id.

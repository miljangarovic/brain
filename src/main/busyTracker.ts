export interface BusyTracker {
  touch(id: string): void  // output arrived → mark busy, (re)arm the idle timer
  input(id: string): void  // user typed → suppress busy for a short window (echo is not "work")
  end(id: string): void    // pty exited → force idle and drop the timers
}

// Derives a per-terminal "is producing output" flag from a stream of output
// notifications. busy flips on at the first chunk and off after `idleMs` of
// silence. While the user is typing (within `typingMs` of the last keystroke)
// busy is suppressed, so the echo / TUI redraw of one's own typing does not
// light the spinner. Emits ONLY on transitions so the renderer doesn't churn.
// (SIGWINCH repaint bursts are filtered in the RENDERER, scoped to explicit
// layout changes — see repaintGuard.ts; filtering here at the resize channel
// proved too broad and swallowed the start of genuine agent answers.)
export function createBusyTracker(
  emit: (id: string, busy: boolean) => void,
  idleMs = 600,
  typingMs = 400
): BusyTracker {
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const busy = new Set<string>()
  const typing = new Set<string>()

  const clearIdle = (id: string): void => {
    const t = idleTimers.get(id)
    if (t) { clearTimeout(t); idleTimers.delete(id) }
  }
  const armIdle = (id: string): void => {
    clearIdle(id)
    idleTimers.set(id, setTimeout(() => {
      idleTimers.delete(id)
      busy.delete(id)
      emit(id, false)
    }, idleMs))
  }

  return {
    touch(id) {
      if (typing.has(id)) return // echo of the user's own typing — not work
      if (!busy.has(id)) { busy.add(id); emit(id, true) }
      armIdle(id)
    },
    input(id) {
      clearIdle(id)
      if (busy.delete(id)) emit(id, false)
      typing.add(id)
      const prev = typingTimers.get(id)
      if (prev) clearTimeout(prev)
      typingTimers.set(id, setTimeout(() => {
        typingTimers.delete(id)
        typing.delete(id)
      }, typingMs))
    },
    end(id) {
      clearIdle(id)
      const tt = typingTimers.get(id)
      if (tt) { clearTimeout(tt); typingTimers.delete(id) }
      typing.delete(id)
      if (busy.delete(id)) emit(id, false)
    }
  }
}

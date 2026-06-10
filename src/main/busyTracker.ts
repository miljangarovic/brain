export interface BusyTracker {
  touch(id: string): void  // output arrived → mark busy, (re)arm the idle timer
  input(id: string): void  // user typed → suppress busy for a short window (echo is not "work")
  resize(id: string): void // pty resized → the SIGWINCH repaint burst is not "work"
  end(id: string): void    // pty exited → force idle and drop the timers
}

// Derives a per-terminal "is producing output" flag from a stream of output
// notifications. busy flips on at the first chunk and off after `idleMs` of
// silence. While the user is typing (within `typingMs` of the last keystroke)
// busy is suppressed, so the echo / TUI redraw of one's own typing does not
// light the spinner. A resize opens a `resizeQuietMs` window during which an
// IDLE terminal's output is ignored — TUIs repaint their whole screen on
// SIGWINCH (e.g. toggling the grid view), and that burst must not light every
// visible agent's loader. An already-busy terminal is unaffected: real work
// keeps the spinner through a resize. Emits ONLY on transitions.
export function createBusyTracker(
  emit: (id: string, busy: boolean) => void,
  idleMs = 600,
  typingMs = 400,
  resizeQuietMs = 1000
): BusyTracker {
  const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const resizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const busy = new Set<string>()
  const typing = new Set<string>()
  const resizing = new Set<string>()

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
      if (resizing.has(id) && !busy.has(id)) return // SIGWINCH repaint of an idle terminal — not work
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
    resize(id) {
      resizing.add(id)
      const prev = resizeTimers.get(id)
      if (prev) clearTimeout(prev)
      resizeTimers.set(id, setTimeout(() => {
        resizeTimers.delete(id)
        resizing.delete(id)
      }, resizeQuietMs))
    },
    end(id) {
      clearIdle(id)
      const tt = typingTimers.get(id)
      if (tt) { clearTimeout(tt); typingTimers.delete(id) }
      typing.delete(id)
      const rt = resizeTimers.get(id)
      if (rt) { clearTimeout(rt); resizeTimers.delete(id) }
      resizing.delete(id)
      if (busy.delete(id)) emit(id, false)
    }
  }
}

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

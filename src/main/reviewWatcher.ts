import { watch as fsWatch } from 'fs'
import { dirname, basename } from 'path'

export type WatchImpl = (
  dir: string,
  listener: (filename: string | null) => void
) => { close(): void }

const defaultWatchImpl: WatchImpl = (dir, listener) => {
  const w = fsWatch(dir, (_event, filename) => listener(filename ? filename.toString() : null))
  return { close: () => { try { w.close() } catch { /* already closed */ } } }
}

/**
 * Watches the DIRECTORY of each target file (so files that don't exist yet are
 * still caught on creation) and fires `onChanged(watchId)` — debounced — when the
 * target's basename (or a null filename) changes.
 */
export function createReviewWatcher(
  onChanged: (watchId: string) => void,
  opts: { debounceMs?: number; watchImpl?: WatchImpl } = {}
) {
  const debounceMs = opts.debounceMs ?? 400
  const watchImpl = opts.watchImpl ?? defaultWatchImpl
  const handles = new Map<string, { close(): void }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const clearTimer = (id: string) => {
    const t = timers.get(id)
    if (t) { clearTimeout(t); timers.delete(id) }
  }

  return {
    watch(watchId: string, filePath: string): void {
      this.unwatch(watchId)
      const dir = dirname(filePath)
      const base = basename(filePath)
      try {
        const handle = watchImpl(dir, (filename) => {
          if (filename !== null && filename !== base) return
          clearTimer(watchId)
          timers.set(watchId, setTimeout(() => { timers.delete(watchId); onChanged(watchId) }, debounceMs))
        })
        handles.set(watchId, handle)
      } catch { /* dir may be missing — caller created it via resolveReviewPaths */ }
    },
    unwatch(watchId: string): void {
      clearTimer(watchId)
      const h = handles.get(watchId)
      if (h) { h.close(); handles.delete(watchId) }
    },
    closeAll(): void {
      for (const id of [...handles.keys()]) this.unwatch(id)
    }
  }
}

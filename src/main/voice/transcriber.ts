// Parent-side handle on the transcriber utilityProcess. One request in
// flight at a time (whisper saturates the machine anyway); a dead child is
// respawned lazily on the next request. forkImpl is injectable for tests.
import { utilityProcess } from 'electron'
import { dirname, join } from 'path'

export interface ChildLike {
  postMessage(msg: unknown): void
  on(event: 'message', cb: (msg: unknown) => void): unknown
  on(event: 'exit', cb: (code: number) => void): unknown
  kill(): boolean
}

interface Pending { resolve: (text: string) => void; reject: (err: Error) => void }

// A queued (not yet dispatched) request: dispatch fn + its reject for early rejection.
interface Queued { dispatch: () => void; reject: (err: Error) => void }

// whisper.node dynamically links libwhisper/libggml shared libs that ship
// NEXT to it inside the addon package (dist/<platform>-<arch>/). The loader
// honors LD_LIBRARY_PATH only from process start, so it must be set on the
// CHILD's env at fork time — setting it inside the child is too late for
// dlopen. (macOS would need DYLD_LIBRARY_PATH instead; Linux-only for now.)
const addonLibDir = () =>
  join(dirname(require.resolve('@kutalia/whisper-node-addon')), '..', `${process.platform}-${process.arch}`)

export function createTranscriber(opts: { childPath: string; forkImpl?: (path: string) => ChildLike }) {
  const fork = opts.forkImpl ?? ((p: string) => {
    const libDir = addonLibDir()
    return utilityProcess.fork(p, [], {
      env: {
        ...process.env,
        LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH ? `${libDir}:${process.env.LD_LIBRARY_PATH}` : libDir
      }
    }) as unknown as ChildLike
  })
  let child: ChildLike | null = null
  let nextId = 1
  const pending = new Map<number, Pending>()
  // Queue of requests waiting to be dispatched (all but the in-flight one).
  const queue: Queued[] = []
  let inFlight = false
  let disposed = false

  const ensureChild = (): ChildLike => {
    if (child) return child
    const c = fork(opts.childPath)
    c.on('message', (raw) => {
      const msg = raw as { id: number; ok: boolean; text?: string; error?: string }
      // utilityProcess delivers { data } envelopes in some Electron versions;
      // the fake (and current Electron) deliver flat values — accept both.
      const m = (msg as unknown as { data?: typeof msg }).data ?? msg
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      inFlight = false
      // Settle the promise, then dispatch next queued item.
      if (m.ok) p.resolve(m.text ?? '')
      else p.reject(new Error(m.error ?? 'transcription failed'))
      // Drain next item from queue.
      const next = queue.shift()
      if (next) { inFlight = true; next.dispatch() }
    })
    c.on('exit', () => {
      child = null
      inFlight = false
      // Reject all in-flight pending requests.
      for (const [id, p] of pending) {
        pending.delete(id)
        p.reject(new Error('transcriber process exited'))
      }
      // Reject all queued requests — do NOT dispatch or fork from here.
      // The next transcribe() call will lazily respawn a new child.
      const drained = queue.splice(0)
      for (const q of drained) q.reject(new Error('transcriber process exited'))
    })
    child = c
    return c
  }

  const transcribe = (req: { wavPath: string; modelPath: string; language: string }, timeoutMs = 60000): Promise<string> => {
    if (disposed) return Promise.reject(new Error('transcriber disposed'))
    return new Promise<string>((resolve, reject) => {
      const id = nextId++

      const settle = () => {
        const timer = setTimeout(() => {
          pending.delete(id)
          inFlight = false
          reject(new Error('transcription timed out'))
          const next = queue.shift()
          if (next) { inFlight = true; next.dispatch() }
        }, timeoutMs)
        pending.set(id, {
          resolve: (t) => { clearTimeout(timer); resolve(t) },
          reject: (e) => { clearTimeout(timer); reject(e) }
        })
        ensureChild().postMessage({ id, ...req })
      }

      if (!inFlight) {
        // Dispatch immediately — keeps first-call synchronous (tests check sent[0] right away).
        inFlight = true
        settle()
      } else {
        // Enqueue for after the in-flight request settles.
        queue.push({
          dispatch: settle,
          reject,
        })
      }
    })
  }

  return {
    transcribe,
    dispose: () => {
      if (disposed) return
      disposed = true
      // Reject queued items BEFORE killing the child — so when kill() fires the
      // exit event synchronously, the exit handler finds an empty queue and
      // empty pending map (no double-settle).
      const drained = queue.splice(0)
      for (const q of drained) q.reject(new Error('transcriber disposed'))
      // Reject in-flight pending requests.
      for (const [id, p] of pending) {
        pending.delete(id)
        p.reject(new Error('transcriber disposed'))
      }
      // Kill child last — exit handler will find empty pending/queue.
      child?.kill()
      child = null
    }
  }
}

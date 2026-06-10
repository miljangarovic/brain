// Parent-side handle on the transcriber utilityProcess. One request in
// flight at a time (whisper saturates the machine anyway); a dead child is
// respawned lazily on the next request. forkImpl is injectable for tests.
import { utilityProcess } from 'electron'

export interface ChildLike {
  postMessage(msg: unknown): void
  on(event: 'message', cb: (msg: unknown) => void): unknown
  on(event: 'exit', cb: (code: number) => void): unknown
  kill(): boolean
}

interface Pending { resolve: (text: string) => void; reject: (err: Error) => void }

export function createTranscriber(opts: { childPath: string; forkImpl?: (path: string) => ChildLike }) {
  const fork = opts.forkImpl ?? ((p: string) => utilityProcess.fork(p) as unknown as ChildLike)
  let child: ChildLike | null = null
  let nextId = 1
  const pending = new Map<number, Pending>()
  // Queue of requests waiting to be dispatched (all but the in-flight one).
  const queue: Array<() => void> = []
  let inFlight = false

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
      if (next) { inFlight = true; next() }
    })
    c.on('exit', () => {
      child = null
      inFlight = false
      for (const [id, p] of pending) { pending.delete(id); p.reject(new Error('transcriber process exited')) }
      // Drain queue with the same error.
      while (queue.length) {
        const next = queue.shift()
        if (next) next()
      }
    })
    child = c
    return c
  }

  const dispatch = (id: number, req: { wavPath: string; modelPath: string; language: string; prompt?: string }) => {
    ensureChild().postMessage({ id, ...req })
  }

  const transcribe = (req: { wavPath: string; modelPath: string; language: string; prompt?: string }, timeoutMs = 60000): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const id = nextId++
      let timer: ReturnType<typeof setTimeout> | undefined

      const settle = (p: Pending) => {
        timer = setTimeout(() => {
          pending.delete(id)
          inFlight = false
          reject(new Error('transcription timed out'))
          const next = queue.shift()
          if (next) { inFlight = true; next() }
        }, timeoutMs)
        pending.set(id, {
          resolve: (t) => { clearTimeout(timer); resolve(t) },
          reject: (e) => { clearTimeout(timer); reject(e) }
        })
      }

      if (!inFlight) {
        // Dispatch immediately — keeps first-call synchronous (tests check sent[0] right away).
        inFlight = true
        settle({ resolve, reject })
        dispatch(id, req)
      } else {
        // Enqueue for after the in-flight request settles.
        queue.push(() => {
          settle({ resolve, reject })
          dispatch(id, req)
        })
      }
    })
  }

  return {
    transcribe,
    dispose: () => { child?.kill(); child = null }
  }
}

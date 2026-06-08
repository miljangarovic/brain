import { promises as fs } from 'fs'
import { Workspace, createWorkspace } from '@shared/types'

export async function loadWorkspace(path: string): Promise<Workspace> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.groups)) return parsed as Workspace
    return createWorkspace()
  } catch {
    return createWorkspace()
  }
}

export async function writeWorkspace(path: string, ws: Workspace): Promise<void> {
  await fs.writeFile(path, JSON.stringify(ws, null, 2), 'utf8')
}

export function createDebouncedSaver(path: string, delayMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Workspace | null = null
  let inflight: Promise<void> | null = null

  const flush = async () => {
    if (!pending) return
    const ws = pending
    pending = null
    try {
      await writeWorkspace(path, ws)
    } catch (err) {
      console.error('[terminaltor] failed to save workspace:', err)
    }
  }

  return {
    save(ws: Workspace) {
      pending = ws
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        inflight = flush().finally(() => { inflight = null })
      }, delayMs)
    },
    // Awaits any write already started by a fired timer, then flushes anything
    // still pending — so callers (e.g. on app quit) are guaranteed the latest
    // workspace has hit disk.
    async flushNow() {
      if (timer) { clearTimeout(timer); timer = null }
      if (inflight) await inflight
      await flush()
    }
  }
}

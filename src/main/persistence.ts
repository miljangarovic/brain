import { promises as fs } from 'fs'
import { Workspace, createWorkspace } from '@shared/types'

const isWorkspaceShape = (v: unknown): v is Workspace =>
  !!v && typeof v === 'object' && Array.isArray((v as { groups?: unknown }).groups)

async function readWorkspaceFile(path: string): Promise<Workspace | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8'))
    return isWorkspaceShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

// A file that exists but doesn't parse into a workspace is moved aside to
// `<path>.corrupt` — never left in place, where the boot-time resave would
// silently overwrite the user's only copy — and the `.bak` kept by the previous
// successful write is restored when valid.
export async function loadWorkspace(path: string): Promise<Workspace> {
  const ws = await readWorkspaceFile(path)
  if (ws) return ws
  const fileExists = await fs.access(path).then(() => true, () => false)
  if (!fileExists) return createWorkspace()
  await fs.rename(path, path + '.corrupt').catch(() => {})
  return (await readWorkspaceFile(path + '.bak')) ?? createWorkspace()
}

// Atomic write: the JSON lands in `<path>.tmp` first and is renamed over the
// real file, so a crash mid-write can never leave it truncated. The previous
// version is kept as `.bak` for corrupt-load recovery.
export async function writeWorkspace(path: string, ws: Workspace): Promise<void> {
  const tmp = path + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(ws, null, 2), 'utf8')
  await fs.copyFile(path, path + '.bak').catch(() => {}) // first write: nothing to back up
  await fs.rename(tmp, path)
}

export function createDebouncedSaver(
  path: string,
  delayMs = 300,
  write: (path: string, ws: Workspace) => Promise<void> = writeWorkspace
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Workspace | null = null
  // All writes append to this chain, so a write that outlives the debounce
  // window can never overlap (and interleave on disk) with the next one.
  let chain: Promise<void> = Promise.resolve()

  const flush = (): Promise<void> => {
    chain = chain.then(async () => {
      if (!pending) return
      const ws = pending
      pending = null
      try {
        await write(path, ws)
      } catch (err) {
        console.error('[brain] failed to save workspace:', err)
      }
    })
    return chain
  }

  return {
    save(ws: Workspace) {
      pending = ws
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; void flush() }, delayMs)
    },
    // Cancels the debounce timer and awaits the whole write chain plus anything
    // still pending — so callers (e.g. on app quit) are guaranteed the latest
    // workspace has hit disk.
    async flushNow() {
      if (timer) { clearTimeout(timer); timer = null }
      await flush()
    },
    // Flush anything pending, then read back from disk — workspace:load uses
    // this so a renderer reload inside the debounce window can't get (and then
    // re-persist) stale state.
    async loadLatest(): Promise<Workspace> {
      await this.flushNow()
      return loadWorkspace(path)
    }
  }
}

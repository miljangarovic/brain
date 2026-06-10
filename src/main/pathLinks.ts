import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { promises as fs } from 'fs'

// Resolve path candidates a terminal printed against that terminal's cwd and
// keep only those that exist on disk; the result is index-aligned with the
// input (null = nothing there, the renderer offers no link). An empty cwd
// means the terminal was spawned in the home dir — same rule as the spawner.
export async function resolveExistingPaths(
  cwd: string,
  candidates: string[],
  home: string = homedir()
): Promise<(string | null)[]> {
  const base = cwd || home
  return Promise.all(candidates.map(async (c) => {
    const expanded = c === '~' ? home : c.startsWith('~/') ? join(home, c.slice(2)) : c
    const abs = isAbsolute(expanded) ? expanded : resolve(base, expanded)
    try {
      await fs.access(abs)
      return abs
    } catch {
      return null
    }
  }))
}

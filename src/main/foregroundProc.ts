// Linux /proc helpers for figuring out what command is actually running inside a
// terminal. node-pty's `process` getter returns only the foreground process
// GROUP LEADER's argv[0]. For a native binary (e.g. claude) that's the agent's
// name, but for a node-wrapped CLI (e.g. codex, run as `node /path/to/codex`)
// it's just "node" — so the live-agent icon never lit up for codex.
//
// Walking the shell's descendant tree and collecting full cmdlines recovers the
// real command ("node /path/to/codex" contains "codex"), and keeps detection
// stable while the agent runs regardless of any short-lived grandchildren.
import { readFileSync, readdirSync } from 'fs'

function cmdlineOf(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`).toString('utf8').replace(/\0/g, ' ').trim()
  } catch {
    return ''
  }
}

function childrenOf(pid: number): number[] {
  try {
    const base = `/proc/${pid}/task`
    const out: number[] = []
    for (const tid of readdirSync(base)) {
      const raw = readFileSync(`${base}/${tid}/children`, 'utf8').trim()
      if (raw) for (const tok of raw.split(/\s+/)) { const n = Number(tok); if (n > 0) out.push(n) }
    }
    return out
  } catch {
    return []
  }
}

// Joined cmdlines of the (bounded) descendant tree of `rootPid`. Empty when the
// process has no children, or on non-Linux platforms where /proc is unavailable.
export function describeDescendants(rootPid: number, maxNodes = 32, maxDepth = 4): string {
  const seen = new Set<number>()
  const parts: string[] = []
  let frontier = childrenOf(rootPid)
  let depth = 0
  while (frontier.length && depth < maxDepth && seen.size < maxNodes) {
    const next: number[] = []
    for (const pid of frontier) {
      if (seen.has(pid)) continue
      seen.add(pid)
      const c = cmdlineOf(pid)
      if (c) parts.push(c)
      next.push(...childrenOf(pid))
      if (seen.size >= maxNodes) break
    }
    frontier = next
    depth++
  }
  return parts.join('\n')
}

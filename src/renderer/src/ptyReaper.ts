// Decides which PTYs to kill. A terminal's shell must outlive the React
// component (so HMR/Fast Refresh remounts don't murder it) — it should die only
// when the terminal is genuinely removed from the workspace. Given the set of
// terminal ids from the previous render and the current one, this returns the
// ids that disappeared, i.e. the shells whose PTY should now be killed.
export function removedIds(prev: Iterable<string>, curr: Iterable<string>): string[] {
  const live = new Set(curr)
  return [...new Set(prev)].filter((id) => !live.has(id))
}

// Drop dead-terminal keys from a per-terminal Record (busy/liveAgents/…).
// Returns the same object when nothing matches so React setters can skip the
// re-render.
export function pruneRecord<T>(rec: Record<string, T>, dead: string[]): Record<string, T> {
  const hits = dead.filter((id) => id in rec)
  if (hits.length === 0) return rec
  const next = { ...rec }
  for (const id of hits) delete next[id]
  return next
}

// Decides which PTYs to kill. A terminal's shell must outlive the React
// component (so HMR/Fast Refresh remounts don't murder it) — it should die only
// when the terminal is genuinely removed from the workspace. Given the set of
// terminal ids from the previous render and the current one, this returns the
// ids that disappeared, i.e. the shells whose PTY should now be killed.
export function removedIds(prev: Iterable<string>, curr: Iterable<string>): string[] {
  const live = new Set(curr)
  return [...new Set(prev)].filter((id) => !live.has(id))
}

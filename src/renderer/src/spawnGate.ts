// Decides whether a terminal's PTY should be spawned (i.e. its TerminalView
// mounted). Terminals restored from disk at boot stay cold until the user
// explicitly opens one — restoring a big workspace must not launch every
// shell and resume every agent session at once. Anything created during the
// session spawns immediately: the creating action is the explicit open.
export function shouldSpawn(id: string, bootIds: ReadonlySet<string>, started: ReadonlySet<string>): boolean {
  return !bootIds.has(id) || started.has(id)
}

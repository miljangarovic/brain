import type { Feature } from '@shared/types'

// Decides whether a terminal's PTY should be spawned (i.e. its TerminalView
// mounted). Terminals restored from disk at boot stay cold until the user
// explicitly opens one — restoring a big workspace must not launch every
// shell and resume every agent session at once. Anything created during the
// session spawns immediately: the creating action is the explicit open.
export function shouldSpawn(id: string, bootIds: ReadonlySet<string>, started: ReadonlySet<string>): boolean {
  return !bootIds.has(id) || started.has(id)
}

// Ids a feature restored from the archive contributes to App's spawn-control
// sets — the same rules as terminals restored from disk at boot: every terminal
// goes back to "cold until opened", and agent terminals spawn with their resume
// command. (Resume eligibility matches the initial-load rule: agent kind alone;
// a missing sessionId falls back to --continue / resume --last at spawn.)
export function restoredSpawnIds(feature: Feature): { bootIds: string[]; resumeIds: string[] } {
  return {
    bootIds: feature.terminals.map((t) => t.id),
    resumeIds: feature.terminals.filter((t) => t.kind === 'claude' || t.kind === 'codex').map((t) => t.id)
  }
}

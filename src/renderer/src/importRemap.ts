import type { Feature, Group, Terminal } from '@shared/types'
import type { ExportManifest } from '@shared/exportTypes'
import { agentContinueCommand, agentLaunchCommand } from './agents'

// Prefix-remap a cwd from the exported root onto the user-picked one.
// Path-segment aware: '/old/proj' rewrites '/old/proj/sub' but not '/old/project-x'.
export function remapCwd(cwd: string, oldRoot: string, newRoot: string | null): string {
  if (!newRoot || !oldRoot || !cwd) return cwd
  if (cwd === oldRoot) return newRoot
  if (cwd.startsWith(oldRoot + '/')) return newRoot + cwd.slice(oldRoot.length)
  return cwd
}

// Every distinct non-'' cwd the import would use, post-remap. The caller checks
// which exist (fs lives in the main process) and feeds the answer to buildImport.
export function collectCwdCandidates(manifest: ExportManifest, newRoot: string | null): string[] {
  const oldRoot = manifest.group.cwd
  const features = manifest.scope === 'group'
    ? [...manifest.group.features, ...(manifest.group.archivedFeatures ?? [])]
    : [manifest.feature]
  const set = new Set<string>()
  const root = remapCwd(oldRoot, oldRoot, newRoot)
  if (root) set.add(root)
  for (const f of features)
    for (const t of f.terminals) {
      const c = remapCwd(t.cwd, oldRoot, newRoot)
      if (c) set.add(c)
    }
  return [...set]
}

export interface BuiltImport {
  scope: 'group' | 'feature'
  group?: Group       // scope 'group'
  feature?: Feature   // scope 'feature'
  fallbackGroup: { name: string; cwd: string }  // creates a group when the workspace has none
  terminalIds: string[]   // fresh ids of ACTIVE features' terminals — the caller spawn-gates
                          // them; archived terminals are excluded (restore re-seeds them)
}

// The pure import transformation: fresh ids everywhere, cwds remapped (dead ones
// fall back to '' = home), review links stripped (their paths are machine-local),
// and agent startup commands rebuilt — continue-from-summary when a summary
// exists, plain fresh launch otherwise. Old sessionIds are never carried over;
// claude terminals get a fresh pinned id so a later restart resumes correctly.
export function buildImport(opts: {
  manifest: ExportManifest
  dir: string                        // absolute dir of the extracted archive
  newRoot: string | null
  exists: (path: string) => boolean
  createId: () => string
}): BuiltImport {
  const { manifest, dir, newRoot, exists, createId } = opts
  const oldRoot = manifest.group.cwd
  const terminalIds: string[] = []

  const fixCwd = (cwd: string): string => {
    const c = remapCwd(cwd, oldRoot, newRoot)
    return c === '' || exists(c) ? c : ''
  }

  const importTerminal = (t: Terminal, track: boolean): Terminal => {
    const id = createId()
    if (track) terminalIds.push(id)
    const base: Terminal = { id, name: t.name, cwd: fixCwd(t.cwd) }
    if (t.shell) base.shell = t.shell
    if (t.kind && t.kind !== 'shell') base.kind = t.kind
    if (t.kind === 'claude' || t.kind === 'codex') {
      const session = manifest.sessions[t.id]
      // session.file is always POSIX-style ('sessions/x.md'); a '/' join works
      // on every platform Node/the agent CLIs support, even with a Windows dir.
      const summaryPath = session?.file ? `${dir}/${session.file}` : null
      const sessionId = t.kind === 'claude' ? createId() : undefined
      if (sessionId) base.sessionId = sessionId
      base.startupCommand = summaryPath
        ? agentContinueCommand(t.kind, summaryPath, sessionId)
        : agentLaunchCommand(t.kind, sessionId)
      return base
    }
    if (t.startupCommand) base.startupCommand = t.startupCommand
    return base
  }

  const importFeature = (f: Feature, track = true): Feature => ({
    id: createId(),
    name: f.name,
    collapsed: f.collapsed,
    ...(f.viewMode ? { viewMode: f.viewMode } : {}),
    ...(f.gridStyle ? { gridStyle: f.gridStyle } : {}),
    // Document paths stay VERBATIM: dead ones just render as broken rows.
    ...(f.documents?.length ? { documents: f.documents.map((d) => ({ id: createId(), name: d.name, path: d.path })) } : {}),
    // Open-file panes: fresh ids, VERBATIM paths (dead ones show the missing
    // fallback), persisted mdView kept. Never spawn-gated — not in terminalIds.
    ...(f.files?.length
      ? { files: f.files.map((p) => ({ id: createId(), name: p.name, path: p.path, ...(p.mdView ? { mdView: p.mdView } : {}) })) }
      : {}),
    terminals: f.terminals.map((t) => importTerminal(t, track))
  })

  const fallbackGroup = { name: manifest.group.name, cwd: fixCwd(oldRoot) }
  if (manifest.scope === 'feature')
    return { scope: 'feature', feature: importFeature(manifest.feature), fallbackGroup, terminalIds }
  return {
    scope: 'group',
    group: {
      id: createId(),
      name: manifest.group.name,
      cwd: fixCwd(oldRoot),
      collapsed: false,
      features: manifest.group.features.map((f) => importFeature(f)),
      ...(manifest.group.archivedFeatures?.length
        ? { archivedFeatures: manifest.group.archivedFeatures.map((f) => importFeature(f, false)) }
        : {})
    },
    fallbackGroup,
    terminalIds
  }
}

import { Workspace, Group, Feature, Terminal, TerminalKind, ReviewLink, GridStyle, createWorkspace, FeatureDoc, FilePane } from '@shared/types'
import { createId } from '@shared/id'

export interface AppState {
  workspace: Workspace
  activeGroupId: string | null
  activeFeatureId: string | null
  activeTerminalId: string | null // the ACTIVE PANE id — a terminal OR an open file pane
  hidden: string[] // terminal ids hidden from the tab bar; their shell keeps running (transient)
}

// ---- helpers -------------------------------------------------------------
const mapGroups = (ws: Workspace, fn: (g: Group) => Group): Workspace => ({ groups: ws.groups.map(fn) })

const mapGroup = (ws: Workspace, groupId: string, fn: (g: Group) => Group): Workspace =>
  mapGroups(ws, (g) => (g.id === groupId ? fn(g) : g))

const mapFeature = (ws: Workspace, featureId: string, fn: (f: Feature) => Feature): Workspace =>
  mapGroups(ws, (g) => ({ ...g, features: g.features.map((f) => (f.id === featureId ? fn(f) : f)) }))

const groupOfFeature = (ws: Workspace, featureId: string): Group | undefined =>
  ws.groups.find((g) => g.features.some((f) => f.id === featureId))

const groupOfArchived = (ws: Workspace, featureId: string): Group | undefined =>
  ws.groups.find((g) => (g.archivedFeatures ?? []).some((f) => f.id === featureId))

const featureOfTerminal = (ws: Workspace, terminalId: string): { group: Group; feature: Feature } | undefined => {
  for (const g of ws.groups) for (const f of g.features) if (f.terminals.some((t) => t.id === terminalId)) return { group: g, feature: f }
  return undefined
}

const featureOfFilePane = (ws: Workspace, paneId: string): { group: Group; feature: Feature } | undefined => {
  for (const g of ws.groups) for (const f of g.features) if ((f.files ?? []).some((p) => p.id === paneId)) return { group: g, feature: f }
  return undefined
}

// First terminal of `f` that isn't hidden from the tab bar — activating a hidden
// terminal would select something with no visible tab or pane.
const firstVisibleTerminal = (f: Feature | null, hidden: string[]): Terminal | null =>
  f?.terminals.find((t) => !hidden.includes(t.id)) ?? null

// The uniform selection fallback: first visible terminal, else first file pane.
const firstVisiblePane = (f: Feature | null, hidden: string[]): { id: string } | null =>
  firstVisibleTerminal(f, hidden) ?? f?.files?.[0] ?? null

const selectFeature = (g: Group | null, hidden: string[]): { featureId: string | null; terminalId: string | null } => {
  const f = g?.features[0] ?? null
  return { featureId: f?.id ?? null, terminalId: firstVisibleTerminal(f, hidden)?.id ?? null }
}

// ---- init ----------------------------------------------------------------
export function createInitialState(ws: Workspace = createWorkspace()): AppState {
  const g = ws.groups[0] ?? null
  const sel = selectFeature(g, [])
  return { workspace: ws, activeGroupId: g?.id ?? null, activeFeatureId: sel.featureId, activeTerminalId: sel.terminalId, hidden: [] }
}

// ---- groups --------------------------------------------------------------
export function addGroup(state: AppState, name: string, cwd: string): AppState {
  const feature: Feature = { id: createId(), name: 'general', collapsed: false, terminals: [] }
  const group: Group = { id: createId(), name, cwd, collapsed: false, features: [feature] }
  return {
    ...state,
    workspace: { groups: [...state.workspace.groups, group] },
    activeGroupId: group.id,
    activeFeatureId: feature.id,
    activeTerminalId: null
  }
}

export function renameGroup(state: AppState, groupId: string, name: string): AppState {
  return { ...state, workspace: mapGroup(state.workspace, groupId, (g) => ({ ...g, name })) }
}

export function toggleGroupCollapsed(state: AppState, groupId: string): AppState {
  return { ...state, workspace: mapGroup(state.workspace, groupId, (g) => ({ ...g, collapsed: !g.collapsed })) }
}

export function deleteGroup(state: AppState, groupId: string): AppState {
  const groups = state.workspace.groups.filter((g) => g.id !== groupId)
  let { activeGroupId, activeFeatureId, activeTerminalId } = state
  if (activeGroupId === groupId) {
    const ng = groups[0] ?? null
    const sel = selectFeature(ng, state.hidden)
    activeGroupId = ng?.id ?? null
    activeFeatureId = sel.featureId
    activeTerminalId = sel.terminalId
  }
  return { ...state, workspace: { groups }, activeGroupId, activeFeatureId, activeTerminalId }
}

// Reorder a project within the workspace. Mirrors `moveFeature`: remove it from
// its current slot and re-insert at clamp(toIndex, 0, len-1). Every group's
// contents and the active selection are left untouched.
export function moveGroup(state: AppState, groupId: string, toIndex: number): AppState {
  const { groups } = state.workspace
  const moved = groups.find((g) => g.id === groupId)
  if (!moved) return state
  const rest = groups.filter((g) => g.id !== groupId)
  const dest = Math.max(0, Math.min(toIndex, rest.length))
  return { ...state, workspace: { groups: [...rest.slice(0, dest), moved, ...rest.slice(dest)] } }
}

// ---- import ----------------------------------------------------------------
// Insert an imported group (already carrying fresh ids) and activate it.
export function addImportedGroup(state: AppState, group: Group): AppState {
  const sel = selectFeature(group, state.hidden)
  return {
    ...state,
    workspace: { groups: [...state.workspace.groups, group] },
    activeGroupId: group.id,
    activeFeatureId: sel.featureId,
    activeTerminalId: sel.terminalId
  }
}

// Insert an imported feature into the active group (fallback: first group; an
// empty workspace gets a group built from the export's own name/cwd).
export function addImportedFeature(state: AppState, feature: Feature, fallback: { name: string; cwd: string }): AppState {
  const target = getActiveGroup(state) ?? state.workspace.groups[0] ?? null
  // Fresh import: no terminal id can be in state.hidden yet, so terminals[0]
  // is always visible — no need for the hidden-aware selectFeature here.
  const first = feature.terminals[0]?.id ?? null
  if (!target) {
    const group: Group = { id: createId(), name: fallback.name, cwd: fallback.cwd, collapsed: false, features: [feature] }
    return { ...state, workspace: { groups: [group] }, activeGroupId: group.id, activeFeatureId: feature.id, activeTerminalId: first }
  }
  return {
    ...state,
    workspace: mapGroup(state.workspace, target.id, (g) => ({ ...g, collapsed: false, features: [...g.features, feature] })),
    activeGroupId: target.id,
    activeFeatureId: feature.id,
    activeTerminalId: first
  }
}

// ---- features ------------------------------------------------------------
export function addFeature(state: AppState, groupId: string, name: string): AppState {
  const feature: Feature = { id: createId(), name, collapsed: false, terminals: [] }
  return {
    ...state,
    workspace: mapGroup(state.workspace, groupId, (g) => ({ ...g, collapsed: false, features: [...g.features, feature] })),
    activeGroupId: groupId,
    activeFeatureId: feature.id,
    activeTerminalId: null
  }
}

export function renameFeature(state: AppState, featureId: string, name: string): AppState {
  return { ...state, workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, name })) }
}

export function toggleFeatureCollapsed(state: AppState, featureId: string): AppState {
  return { ...state, workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, collapsed: !f.collapsed })) }
}

export function setFeatureGridStyle(state: AppState, featureId: string, gridStyle: GridStyle): AppState {
  return { ...state, workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, gridStyle })) }
}

export function toggleFeatureViewMode(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId) ?? null
  const nextMode = (feature?.viewMode ?? 'tabs') === 'tabs' ? 'grid' : 'tabs'
  const workspace = mapFeature(state.workspace, featureId, (f) => ({ ...f, viewMode: nextMode }))
  // Opening the grid shows every pane; closing it collapses back to a single tab,
  // so focus the feature's first (visible) terminal — exactly one stays on, no
  // matter which pane happened to be active in the grid.
  if (nextMode === 'tabs' && feature) {
    const first = feature.terminals.find((t) => !state.hidden.includes(t.id)) ?? feature.terminals[0] ?? null
    return {
      ...state,
      workspace,
      activeGroupId: group?.id ?? state.activeGroupId,
      activeFeatureId: featureId,
      activeTerminalId: first?.id ?? state.activeTerminalId
    }
  }
  // Entering the grid is a fresh survey of the feature: every X-ed (hidden)
  // terminal returns to the board (and to the tab bar). X-ing a pane while the
  // grid is open still prunes it — until the next grid open.
  const ids = new Set((feature?.terminals ?? []).map((t) => t.id))
  return { ...state, workspace, hidden: state.hidden.filter((id) => !ids.has(id)) }
}

export function deleteFeature(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const ws = group
    ? mapGroup(state.workspace, group.id, (g) => ({ ...g, features: g.features.filter((f) => f.id !== featureId) }))
    : state.workspace
  let { activeFeatureId, activeTerminalId } = state
  if (activeFeatureId === featureId) {
    const g2 = ws.groups.find((g) => g.id === group?.id) ?? null
    const sel = selectFeature(g2, state.hidden)
    activeFeatureId = sel.featureId
    activeTerminalId = sel.terminalId
  }
  return { ...state, workspace: ws, activeFeatureId, activeTerminalId }
}

// Reorder a feature within its own group. `toIndex` is the desired final
// 0-based position: the feature is removed from its current slot and re-inserted
// at clamp(toIndex, 0, len-1), so it ends up exactly at `toIndex`. Other groups,
// the feature's terminals, and the active selection are left untouched.
export function moveFeature(state: AppState, featureId: string, toIndex: number): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  if (!group) return state
  const moved = group.features.find((f) => f.id === featureId)
  if (!moved) return state
  const rest = group.features.filter((f) => f.id !== featureId)
  const dest = Math.max(0, Math.min(toIndex, rest.length))
  const features = [...rest.slice(0, dest), moved, ...rest.slice(dest)]
  return { ...state, workspace: mapGroup(state.workspace, group.id, (g) => ({ ...g, features })) }
}

// ---- archive ---------------------------------------------------------------
// Move a feature out of the active list into its group's archive. Its terminals
// leave the workspace tree, so the PTY reaper kills their processes. Selection
// follows the deleteFeature rule when the archived feature was active;
// activeGroupId is untouched (the active feature is always in the active group).
export function archiveFeature(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId)
  if (!group || !feature) return state
  const ws = mapGroup(state.workspace, group.id, (g) => ({
    ...g,
    features: g.features.filter((f) => f.id !== featureId),
    archivedFeatures: [...(g.archivedFeatures ?? []), feature]
  }))
  const termIds = new Set(feature.terminals.map((t) => t.id))
  const hidden = state.hidden.filter((id) => !termIds.has(id))
  let { activeFeatureId, activeTerminalId } = state
  if (activeFeatureId === featureId) {
    const g2 = ws.groups.find((g) => g.id === group.id) ?? null
    const sel = selectFeature(g2, hidden)
    activeFeatureId = sel.featureId
    activeTerminalId = sel.terminalId
  }
  return { ...state, workspace: ws, activeFeatureId, activeTerminalId, hidden }
}

// Move an archived feature back to the END of its group's active list. The
// active selection is untouched — the archive dialog stays open for more moves.
// The caller (App) re-seeds the boot/resume spawn sets for its terminals.
export function restoreFeature(state: AppState, featureId: string): AppState {
  const group = groupOfArchived(state.workspace, featureId)
  const feature = group?.archivedFeatures?.find((f) => f.id === featureId)
  if (!group || !feature) return state
  return {
    ...state,
    workspace: mapGroup(state.workspace, group.id, (g) => ({
      ...g,
      features: [...g.features, feature],
      archivedFeatures: (g.archivedFeatures ?? []).filter((f) => f.id !== featureId)
    }))
  }
}

// Permanently delete a feature from the archive (the UI confirms first).
export function deleteArchivedFeature(state: AppState, featureId: string): AppState {
  const group = groupOfArchived(state.workspace, featureId)
  if (!group) return state
  return {
    ...state,
    workspace: mapGroup(state.workspace, group.id, (g) => ({
      ...g,
      archivedFeatures: (g.archivedFeatures ?? []).filter((f) => f.id !== featureId)
    }))
  }
}

// ---- documents -------------------------------------------------------------
// Documents are named references to files on disk; the file itself is never
// touched. All three operate on ACTIVE features only — an archived feature's
// documents ride along untouched until restore (mapFeature walks g.features).
export function addDocument(state: AppState, featureId: string, input: { name: string; path: string; id?: string }): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId)
  if (!feature) return state
  if ((feature.documents ?? []).some((d) => d.path === input.path)) return state // duplicate path: no-op
  const doc: FeatureDoc = { id: input.id ?? createId(), name: input.name, path: input.path }
  return { ...state, workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, documents: [...(f.documents ?? []), doc] })) }
}

export function renameDocument(state: AppState, featureId: string, docId: string, name: string): AppState {
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({
      ...f, documents: (f.documents ?? []).map((d) => (d.id === docId ? { ...d, name } : d))
    }))
  }
}

export function removeDocument(state: AppState, featureId: string, docId: string): AppState {
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({
      ...f, documents: (f.documents ?? []).filter((d) => d.id !== docId)
    }))
  }
}

// ---- file panes ------------------------------------------------------------
// Open files shown as panes of a feature, parallel to terminals — no PTY, no
// spawn gating, never in `hidden`. Operations target ACTIVE features only.
export function openFile(state: AppState, featureId: string, input: { path: string; name?: string; id?: string }): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId)
  if (!group || !feature) return state
  const existing = (feature.files ?? []).find((p) => p.path === input.path)
  if (existing) return setActiveTerminal(state, existing.id)
  const pane: FilePane = {
    id: input.id ?? createId(),
    path: input.path,
    name: input.name ?? (input.path.split('/').pop() || input.path)
  }
  const next = {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, files: [...(f.files ?? []), pane] }))
  }
  return setActiveTerminal(next, pane.id)
}

export function closeFile(state: AppState, paneId: string): AppState {
  const loc = featureOfFilePane(state.workspace, paneId)
  if (!loc) return state
  const workspace = mapFeature(state.workspace, loc.feature.id, (f) => ({
    ...f, files: (f.files ?? []).filter((p) => p.id !== paneId)
  }))
  let { activeTerminalId } = state
  if (activeTerminalId === paneId) {
    const f2 = workspace.groups.flatMap((g) => g.features).find((f) => f.id === loc.feature.id) ?? null
    activeTerminalId = firstVisiblePane(f2, state.hidden)?.id ?? null
  }
  return { ...state, workspace, activeTerminalId }
}

// Reorder a file pane within its feature. Mirrors moveTerminal.
export function moveFile(state: AppState, paneId: string, toIndex: number): AppState {
  const loc = featureOfFilePane(state.workspace, paneId)
  if (!loc) return state
  const files = loc.feature.files ?? []
  const moved = files.find((p) => p.id === paneId)!
  const rest = files.filter((p) => p.id !== paneId)
  const dest = Math.max(0, Math.min(toIndex, rest.length))
  return {
    ...state,
    workspace: mapFeature(state.workspace, loc.feature.id, (f) => ({ ...f, files: [...rest.slice(0, dest), moved, ...rest.slice(dest)] }))
  }
}

const patchFilePane = (state: AppState, paneId: string, patch: Partial<FilePane>): AppState => {
  const loc = featureOfFilePane(state.workspace, paneId)
  if (!loc) return state
  return {
    ...state,
    workspace: mapFeature(state.workspace, loc.feature.id, (f) => ({
      ...f, files: (f.files ?? []).map((p) => (p.id === paneId ? { ...p, ...patch } : p))
    }))
  }
}

export function renameFilePane(state: AppState, paneId: string, name: string): AppState {
  return patchFilePane(state, paneId, { name })
}

export function setFilePaneMdView(state: AppState, paneId: string, mdView: 'rendered' | 'raw'): AppState {
  return patchFilePane(state, paneId, { mdView })
}

export const findFilePane = (s: AppState, paneId: string): { feature: Feature; pane: FilePane } | null => {
  const loc = featureOfFilePane(s.workspace, paneId)
  if (!loc) return null
  return { feature: loc.feature, pane: (loc.feature.files ?? []).find((p) => p.id === paneId)! }
}

// ---- terminals -----------------------------------------------------------
export function addTerminal(
  state: AppState,
  featureId: string,
  input: { name: string; startupCommand?: string; kind?: TerminalKind; review?: ReviewLink; id?: string; sessionId?: string }
): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const startupCommand = input.startupCommand?.trim()
  const term: Terminal = {
    id: input.id ?? createId(),
    name: input.name,
    cwd: group?.cwd ?? '',
    startupCommand: startupCommand || undefined,
    kind: input.kind && input.kind !== 'shell' ? input.kind : undefined,
    ...(input.review ? { review: input.review } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {})
  }
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, collapsed: false, terminals: [...f.terminals, term] })),
    activeGroupId: group?.id ?? state.activeGroupId,
    activeFeatureId: featureId,
    activeTerminalId: term.id
  }
}

export function renameTerminal(state: AppState, terminalId: string, name: string): AppState {
  return {
    ...state,
    workspace: mapGroups(state.workspace, (g) => ({
      ...g,
      features: g.features.map((f) => ({ ...f, terminals: f.terminals.map((t) => (t.id === terminalId ? { ...t, name } : t)) }))
    }))
  }
}

// Reorder a terminal within its own feature. Mirrors `moveFeature`: remove it
// from its current slot and re-insert at clamp(toIndex, 0, len-1). Other features
// and the active selection are left untouched.
// Record the agent conversation id discovered for a terminal (codex, after its
// rollout file appears). No-op if the terminal is gone by the time it resolves.
// Reaches archived terminals too (codex session capture racing an archive).
export function setTerminalSessionId(state: AppState, terminalId: string, sessionId: string): AppState {
  const patch = (f: Feature): Feature => ({
    ...f, terminals: f.terminals.map((t) => (t.id === terminalId ? { ...t, sessionId } : t))
  })
  return {
    ...state,
    workspace: mapGroups(state.workspace, (g) => ({
      ...g,
      features: g.features.map(patch),
      ...(g.archivedFeatures ? { archivedFeatures: g.archivedFeatures.map(patch) } : {})
    }))
  }
}

export function moveTerminal(state: AppState, terminalId: string, toIndex: number): AppState {
  const found = featureOfTerminal(state.workspace, terminalId)
  if (!found) return state
  const { feature } = found
  const moved = feature.terminals.find((t) => t.id === terminalId)!
  const rest = feature.terminals.filter((t) => t.id !== terminalId)
  const dest = Math.max(0, Math.min(toIndex, rest.length))
  const terminals = [...rest.slice(0, dest), moved, ...rest.slice(dest)]
  return { ...state, workspace: mapFeature(state.workspace, feature.id, (f) => ({ ...f, terminals })) }
}

export function patchReviewLink(state: AppState, terminalId: string, patch: Partial<ReviewLink>): AppState {
  return {
    ...state,
    workspace: mapGroups(state.workspace, (g) => ({
      ...g,
      features: g.features.map((f) => ({
        ...f,
        terminals: f.terminals.map((t) =>
          t.id === terminalId && t.review ? { ...t, review: { ...t.review, ...patch } } : t)
      }))
    }))
  }
}

export function removeTerminal(state: AppState, terminalId: string): AppState {
  const hidden = state.hidden.filter((x) => x !== terminalId)
  let activeTerminalId = state.activeTerminalId
  const workspace = mapGroups(state.workspace, (g) => ({
    ...g,
    features: g.features.map((f) => {
      const idx = f.terminals.findIndex((t) => t.id === terminalId)
      if (idx === -1) return f
      const terminals = f.terminals.filter((t) => t.id !== terminalId)
      if (activeTerminalId === terminalId) {
        const cand = terminals[idx] ?? terminals[idx - 1]
        const pick = cand && !hidden.includes(cand.id) ? cand : terminals.find((t) => !hidden.includes(t.id))
        activeTerminalId = pick?.id ?? null
      }
      return { ...f, terminals }
    })
  }))
  return { ...state, workspace, activeTerminalId, hidden }
}

// Hide a terminal from the tab bar — its shell keeps running (the TerminalView
// stays mounted). If it was the active one, move selection to a visible sibling.
export function hideTerminal(state: AppState, terminalId: string): AppState {
  if (state.hidden.includes(terminalId)) return state
  const hidden = [...state.hidden, terminalId]
  let activeTerminalId = state.activeTerminalId
  if (activeTerminalId === terminalId) {
    const loc = featureOfTerminal(state.workspace, terminalId)
    const sib = loc?.feature.terminals.find((t) => t.id !== terminalId && !hidden.includes(t.id))
    activeTerminalId = sib?.id ?? null
  }
  return { ...state, hidden, activeTerminalId }
}

// Un-hide a terminal (it reappears as a tab with its preserved shell) and activate it.
// Unknown ids are a strict no-op — callers route arbitrary keys here (e.g. OS
// notification keys like 'export:<path>'), and activating a nonexistent id
// would blank the tab pane.
export function showTerminal(state: AppState, terminalId: string): AppState {
  const loc = featureOfTerminal(state.workspace, terminalId)
  if (!loc) return state
  return {
    ...state,
    hidden: state.hidden.filter((x) => x !== terminalId),
    activeGroupId: loc.group.id,
    activeFeatureId: loc.feature.id,
    activeTerminalId: terminalId
  }
}

export const isHidden = (s: AppState, terminalId: string): boolean => s.hidden.includes(terminalId)

// ---- active selection ----------------------------------------------------
export function setActiveGroup(state: AppState, groupId: string): AppState {
  const g = state.workspace.groups.find((x) => x.id === groupId) ?? null
  const sel = selectFeature(g, state.hidden)
  return { ...state, activeGroupId: groupId, activeFeatureId: sel.featureId, activeTerminalId: sel.terminalId }
}

export function setActiveFeature(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId) ?? null
  return {
    ...state,
    activeGroupId: group?.id ?? state.activeGroupId,
    activeFeatureId: featureId,
    activeTerminalId: firstVisibleTerminal(feature, state.hidden)?.id ?? null
  }
}

export function setActiveTerminal(state: AppState, terminalId: string): AppState {
  const loc = featureOfTerminal(state.workspace, terminalId) ?? featureOfFilePane(state.workspace, terminalId)
  return {
    ...state,
    activeGroupId: loc?.group.id ?? state.activeGroupId,
    activeFeatureId: loc?.feature.id ?? state.activeFeatureId,
    activeTerminalId: terminalId
  }
}

// ---- selectors -----------------------------------------------------------
export const getActiveGroup = (s: AppState): Group | null =>
  s.workspace.groups.find((g) => g.id === s.activeGroupId) ?? null

export const getActiveFeature = (s: AppState): Feature | null => {
  for (const g of s.workspace.groups) { const f = g.features.find((f) => f.id === s.activeFeatureId); if (f) return f }
  return null
}

export const getActiveTerminal = (s: AppState): Terminal | null => {
  const f = getActiveFeature(s)
  return f?.terminals.find((t) => t.id === s.activeTerminalId) ?? null
}

export const allTerminals = (s: AppState): Terminal[] =>
  s.workspace.groups.flatMap((g) => g.features.flatMap((f) => f.terminals))

export const getTerminalById = (s: AppState, id: string): Terminal | null =>
  allTerminals(s).find((t) => t.id === id) ?? null

export const findReviewerFor = (s: AppState, originId: string): Terminal | null =>
  allTerminals(s).find((t) => t.review?.originTerminalId === originId) ?? null

export const featureIdOfTerminal = (s: AppState, terminalId: string): string | null => {
  for (const g of s.workspace.groups) for (const f of g.features) if (f.terminals.some((t) => t.id === terminalId)) return f.id
  return null
}

// A terminal the review loop owns: a reviewer (has a review link) or an origin
// some active reviewer points at. Attention routing skips these — review status
// already signals them.
export const isUnderReview = (s: AppState, id: string): boolean => {
  const t = getTerminalById(s, id)
  if (t?.review) return true
  return allTerminals(s).some((x) => x.review?.originTerminalId === id)
}

// "Project › Feature › Terminal" label for a terminal id; '' if not found.
export function terminalPath(s: AppState, id: string): string {
  for (const g of s.workspace.groups)
    for (const f of g.features) {
      const t = f.terminals.find((t) => t.id === id)
      if (t) return `${g.name} › ${f.name} › ${t.name}`
    }
  return ''
}

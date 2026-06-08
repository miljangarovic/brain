import { Workspace, Group, Feature, Terminal, TerminalKind, createWorkspace } from '@shared/types'
import { createId } from '@shared/id'

export interface AppState {
  workspace: Workspace
  activeGroupId: string | null
  activeFeatureId: string | null
  activeTerminalId: string | null
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

const featureOfTerminal = (ws: Workspace, terminalId: string): { group: Group; feature: Feature } | undefined => {
  for (const g of ws.groups) for (const f of g.features) if (f.terminals.some((t) => t.id === terminalId)) return { group: g, feature: f }
  return undefined
}

const selectFeature = (g: Group | null): { featureId: string | null; terminalId: string | null } => {
  const f = g?.features[0] ?? null
  return { featureId: f?.id ?? null, terminalId: f?.terminals[0]?.id ?? null }
}

// ---- init ----------------------------------------------------------------
export function createInitialState(ws: Workspace = createWorkspace()): AppState {
  const g = ws.groups[0] ?? null
  const sel = selectFeature(g)
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
    const sel = selectFeature(ng)
    activeGroupId = ng?.id ?? null
    activeFeatureId = sel.featureId
    activeTerminalId = sel.terminalId
  }
  return { ...state, workspace: { groups }, activeGroupId, activeFeatureId, activeTerminalId }
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

export function toggleFeatureViewMode(state: AppState, featureId: string): AppState {
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, viewMode: (f.viewMode ?? 'tabs') === 'tabs' ? 'grid' : 'tabs' }))
  }
}

export function deleteFeature(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const ws = group
    ? mapGroup(state.workspace, group.id, (g) => ({ ...g, features: g.features.filter((f) => f.id !== featureId) }))
    : state.workspace
  let { activeFeatureId, activeTerminalId } = state
  if (activeFeatureId === featureId) {
    const g2 = ws.groups.find((g) => g.id === group?.id) ?? null
    const sel = selectFeature(g2)
    activeFeatureId = sel.featureId
    activeTerminalId = sel.terminalId
  }
  return { ...state, workspace: ws, activeFeatureId, activeTerminalId }
}

// ---- terminals -----------------------------------------------------------
export function addTerminal(
  state: AppState,
  featureId: string,
  input: { name: string; startupCommand?: string; kind?: TerminalKind }
): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const startupCommand = input.startupCommand?.trim()
  const term: Terminal = {
    id: createId(),
    name: input.name,
    cwd: group?.cwd ?? '',
    startupCommand: startupCommand || undefined,
    kind: input.kind && input.kind !== 'shell' ? input.kind : undefined
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
export function showTerminal(state: AppState, terminalId: string): AppState {
  const loc = featureOfTerminal(state.workspace, terminalId)
  return {
    ...state,
    hidden: state.hidden.filter((x) => x !== terminalId),
    activeGroupId: loc?.group.id ?? state.activeGroupId,
    activeFeatureId: loc?.feature.id ?? state.activeFeatureId,
    activeTerminalId: terminalId
  }
}

export const isHidden = (s: AppState, terminalId: string): boolean => s.hidden.includes(terminalId)

// ---- active selection ----------------------------------------------------
export function setActiveGroup(state: AppState, groupId: string): AppState {
  const g = state.workspace.groups.find((x) => x.id === groupId) ?? null
  const sel = selectFeature(g)
  return { ...state, activeGroupId: groupId, activeFeatureId: sel.featureId, activeTerminalId: sel.terminalId }
}

export function setActiveFeature(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId) ?? null
  return {
    ...state,
    activeGroupId: group?.id ?? state.activeGroupId,
    activeFeatureId: featureId,
    activeTerminalId: feature?.terminals[0]?.id ?? null
  }
}

export function setActiveTerminal(state: AppState, terminalId: string): AppState {
  const loc = featureOfTerminal(state.workspace, terminalId)
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

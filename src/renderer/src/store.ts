import { Workspace, Group, Terminal, TerminalKind, createWorkspace } from '@shared/types'
import { createId } from '@shared/id'

export interface AppState {
  workspace: Workspace
  activeGroupId: string | null
  activeTerminalId: string | null
}

export function createInitialState(ws: Workspace = createWorkspace()): AppState {
  const firstGroup = ws.groups[0] ?? null
  const firstTerm = firstGroup?.terminals[0] ?? null
  return {
    workspace: ws,
    activeGroupId: firstGroup?.id ?? null,
    activeTerminalId: firstTerm?.id ?? null
  }
}

export function addGroup(state: AppState, name: string): AppState {
  const group: Group = { id: createId(), name, collapsed: false, terminals: [] }
  return {
    ...state,
    workspace: { groups: [...state.workspace.groups, group] },
    activeGroupId: group.id,
    activeTerminalId: null
  }
}

export function renameGroup(state: AppState, groupId: string, name: string): AppState {
  return {
    ...state,
    workspace: { groups: state.workspace.groups.map(g => g.id === groupId ? { ...g, name } : g) }
  }
}

export function toggleGroupCollapsed(state: AppState, groupId: string): AppState {
  return {
    ...state,
    workspace: { groups: state.workspace.groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g) }
  }
}

export function toggleGroupViewMode(state: AppState, groupId: string): AppState {
  return {
    ...state,
    workspace: {
      groups: state.workspace.groups.map(g =>
        g.id === groupId
          ? { ...g, viewMode: (g.viewMode ?? 'tabs') === 'tabs' ? 'grid' : 'tabs' }
          : g)
    }
  }
}

export function deleteGroup(state: AppState, groupId: string): AppState {
  const groups = state.workspace.groups.filter(g => g.id !== groupId)
  let { activeGroupId, activeTerminalId } = state
  if (activeGroupId === groupId) {
    const ng = groups[0] ?? null
    activeGroupId = ng?.id ?? null
    activeTerminalId = ng?.terminals[0]?.id ?? null
  }
  return { ...state, workspace: { groups }, activeGroupId, activeTerminalId }
}

export function addTerminal(
  state: AppState,
  groupId: string,
  input: { name: string; cwd: string; startupCommand?: string; shell?: string; kind?: TerminalKind }
): AppState {
  const startupCommand = input.startupCommand?.trim()
  const shell = input.shell?.trim()
  const term: Terminal = {
    id: createId(),
    name: input.name,
    cwd: input.cwd,
    startupCommand: startupCommand || undefined,
    shell: shell || undefined,
    kind: input.kind && input.kind !== 'shell' ? input.kind : undefined
  }
  // Expand the target group so a freshly added terminal is always visible.
  const groups = state.workspace.groups.map(g =>
    g.id === groupId ? { ...g, collapsed: false, terminals: [...g.terminals, term] } : g)
  return { ...state, workspace: { groups }, activeGroupId: groupId, activeTerminalId: term.id }
}

export function removeTerminal(state: AppState, terminalId: string): AppState {
  let activeTerminalId = state.activeTerminalId
  const groups = state.workspace.groups.map(g => {
    const idx = g.terminals.findIndex(t => t.id === terminalId)
    if (idx === -1) return g
    const terminals = g.terminals.filter(t => t.id !== terminalId)
    if (activeTerminalId === terminalId) {
      const next = terminals[idx] ?? terminals[idx - 1] ?? null
      activeTerminalId = next?.id ?? null
    }
    return { ...g, terminals }
  })
  return { ...state, workspace: { groups }, activeTerminalId }
}

export function setActiveGroup(state: AppState, groupId: string): AppState {
  const group = state.workspace.groups.find(g => g.id === groupId)
  return { ...state, activeGroupId: groupId, activeTerminalId: group?.terminals[0]?.id ?? null }
}

export function setActiveTerminal(state: AppState, terminalId: string): AppState {
  const group = state.workspace.groups.find(g => g.terminals.some(t => t.id === terminalId))
  return { ...state, activeTerminalId: terminalId, activeGroupId: group?.id ?? state.activeGroupId }
}

export const getActiveGroup = (s: AppState): Group | null =>
  s.workspace.groups.find(g => g.id === s.activeGroupId) ?? null

export const getActiveTerminal = (s: AppState): Terminal | null => {
  for (const g of s.workspace.groups) {
    const t = g.terminals.find(t => t.id === s.activeTerminalId)
    if (t) return t
  }
  return null
}

export const allTerminals = (s: AppState): Terminal[] =>
  s.workspace.groups.flatMap(g => g.terminals)

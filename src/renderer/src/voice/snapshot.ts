// The names+ids context the intent LLM sees. hidden matters for ordinal tab
// references ("drugi tab" counts only visible tabs); archived features are
// deliberately absent — they have no live panes to act on.
import type { AppState } from '../store'
import type { WorkspaceSnapshot } from '@shared/voice'

export function buildSnapshot(s: AppState): WorkspaceSnapshot {
  // activeTerminalId can hold a FILE PANE id (panes participate in selection,
  // see setActiveTerminal/cycleTab) — the LLM must never target it as a
  // terminal, so it is nulled unless it names a real terminal.
  const terminalIds = new Set(
    s.workspace.groups.flatMap((g) => g.features).flatMap((f) => f.terminals).map((t) => t.id)
  )
  return {
    groups: s.workspace.groups.map((g) => ({
      id: g.id,
      name: g.name,
      features: g.features.map((f) => ({
        id: f.id,
        name: f.name,
        terminals: f.terminals.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind ?? 'shell',
          ...(s.hidden.includes(t.id) ? { hidden: true as const } : {})
        }))
      }))
    })),
    activeFeatureId: s.activeFeatureId,
    activeTerminalId: s.activeTerminalId && terminalIds.has(s.activeTerminalId) ? s.activeTerminalId : null
  }
}

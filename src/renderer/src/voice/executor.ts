// VoiceCommand + live AppState → an execution plan. Pure module: no IPC, no
// effects. Three plan shapes:
//   run     — safe action, applied immediately with a toast
//   confirm — needs the overlay (creates/destroys something, free-text
//             payload, or the LLM flagged low confidence)
//   error   — invalid/unknown/stale — the overlay shows the transcript
// close_terminal/add_terminal yield DELEGATE descriptors (run.ts routes them
// through App's effectful handlers); everything else is a pure state run.
import type { AppState } from '../store'
import {
  setActiveFeature, toggleFeatureViewMode, setActiveTerminal, setFeatureGridStyle,
  hideTerminal, showTerminal, renameFeature, renameTerminal, getTerminalById
} from '../store'
import type { Feature, TerminalKind } from '@shared/types'
import type { VoiceCommand } from '@shared/voice'

export type StateDescriptor = {
  type: 'state'
  run: (s: AppState) => AppState
  toast: string
  // Terminal ids to markStarted() BEFORE apply — mirrors how existing handlers
  // gate spawning (see App.tsx onSelectTerminal / cycleTab).
  startIds?: string[]
}
export type ExecDescriptor =
  | StateDescriptor
  | { type: 'closeTerminal'; terminalId: string }
  | { type: 'addTerminal'; featureId: string; kind: TerminalKind; name?: string; prompt?: string }

export type ExecPlan =
  | { type: 'run'; descriptor: StateDescriptor }
  | { type: 'confirm'; summary: string; editablePrompt?: string; descriptor: ExecDescriptor }
  | { type: 'error'; message: string }

const findFeature = (s: AppState, id: string | undefined): Feature | null =>
  id ? s.workspace.groups.flatMap((g) => g.features).find((f) => f.id === id) ?? null : null

const err = (message: string): ExecPlan => ({ type: 'error', message })

export function planCommand(cmd: VoiceCommand, s: AppState): ExecPlan {
  const plan = planHigh(cmd, s)
  // Low LLM confidence: never run silently — show what was understood first.
  if (cmd.confidence === 'low' && plan.type === 'run') {
    return { type: 'confirm', summary: plan.descriptor.toast, descriptor: plan.descriptor }
  }
  return plan
}

function planHigh(cmd: VoiceCommand, s: AppState): ExecPlan {
  switch (cmd.action) {
    case 'switch_feature': {
      const f = findFeature(s, cmd.featureId)
      if (!f) return err('Feature not found — try again')
      const first = f.terminals.find((t) => !s.hidden.includes(t.id))
      return {
        type: 'run',
        descriptor: {
          type: 'state',
          run: (st) => setActiveFeature(st, f.id),
          toast: `→ ${f.name}`,
          ...(first ? { startIds: [first.id] } : {})
        }
      }
    }
    case 'toggle_grid': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('No feature to toggle')
      const entering = (f.viewMode ?? 'tabs') === 'tabs'
      const hadHidden = f.terminals.some((t) => s.hidden.includes(t.id))
      const note = entering && hadHidden ? ' (hidden terminals restored)' : ''
      return {
        type: 'run',
        descriptor: {
          type: 'state',
          run: (st) => toggleFeatureViewMode(st, f.id),
          toast: `${entering ? 'Grid' : 'Tabs'}: ${f.name}${note}`
        }
      }
    }
    case 'switch_tab': {
      const t = cmd.terminalId ? getTerminalById(s, cmd.terminalId) : null
      if (!t) return err('Terminal not found — try again')
      const hidden = s.hidden.includes(t.id)
      return {
        type: 'run',
        descriptor: {
          type: 'state',
          run: (st) => (hidden ? showTerminal(st, t.id) : setActiveTerminal(st, t.id)),
          toast: `→ ${t.name}`,
          startIds: [t.id]
        }
      }
    }
    case 'set_grid_style': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('No feature selected')
      if (!cmd.gridStyle) return err('No grid style understood')
      const style = cmd.gridStyle
      return {
        type: 'run',
        descriptor: { type: 'state', run: (st) => setFeatureGridStyle(st, f.id, style), toast: `Grid style: ${style}` }
      }
    }
    case 'hide_terminal': {
      const id = cmd.terminalId ?? s.activeTerminalId
      const t = id ? getTerminalById(s, id) : null
      if (!t) return err('Terminal not found — try again')
      return {
        type: 'run',
        descriptor: { type: 'state', run: (st) => hideTerminal(st, t.id), toast: `Hidden: ${t.name}` }
      }
    }
    case 'add_terminal': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('No feature to add the terminal to')
      const kind: TerminalKind = cmd.kind ?? 'claude'
      return {
        type: 'confirm',
        summary: `New ${kind} terminal in "${f.name}"`,
        ...(cmd.prompt ? { editablePrompt: cmd.prompt } : {}),
        descriptor: {
          type: 'addTerminal', featureId: f.id, kind,
          ...(cmd.name ? { name: cmd.name } : {}),
          ...(cmd.prompt ? { prompt: cmd.prompt } : {})
        }
      }
    }
    case 'close_terminal': {
      const id = cmd.terminalId ?? s.activeTerminalId
      const t = id ? getTerminalById(s, id) : null
      if (!t) return err('Terminal not found — try again')
      return {
        type: 'confirm',
        summary: `Close terminal "${t.name}"`,
        descriptor: { type: 'closeTerminal', terminalId: t.id }
      }
    }
    case 'rename_feature': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('Feature not found — try again')
      if (!cmd.name) return err('No new name understood')
      const name = cmd.name
      return {
        type: 'confirm',
        summary: `Rename feature "${f.name}" → "${name}"`,
        descriptor: { type: 'state', run: (st) => renameFeature(st, f.id, name), toast: `Renamed: ${name}` }
      }
    }
    case 'rename_terminal': {
      const id = cmd.terminalId ?? s.activeTerminalId
      const t = id ? getTerminalById(s, id) : null
      if (!t) return err('Terminal not found — try again')
      if (!cmd.name) return err('No new name understood')
      const name = cmd.name
      return {
        type: 'confirm',
        summary: `Rename terminal "${t.name}" → "${name}"`,
        descriptor: { type: 'state', run: (st) => renameTerminal(st, t.id, name), toast: `Renamed: ${name}` }
      }
    }
    case 'unknown':
      return err("Didn't understand the command")
  }
}

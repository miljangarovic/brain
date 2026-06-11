// Voice command domain: the JSON contract between the Groq intent parser
// (main) and the renderer executor. validateVoiceCommand is SHAPE validation
// only — id existence is checked in the renderer against live state.
import type { GridStyle, TerminalKind } from './types'

export const VOICE_ACTIONS = [
  'switch_feature', 'toggle_grid', 'switch_tab', 'set_grid_style',
  'hide_terminal', 'add_terminal', 'close_terminal',
  'rename_feature', 'rename_terminal', 'send_prompt',
  'cycle_tab', 'close_tabs', 'add_feature', 'archive_feature',
  'review_accept', 'review_more_rounds', 'review_stop',
  'unknown'
] as const
export type VoiceAction = (typeof VOICE_ACTIONS)[number]

const GRID_STYLES: GridStyle[] = ['auto', 'auto-left', 'auto-top', 'auto-bottom', 'rows', 'cols']
const KINDS: TerminalKind[] = ['shell', 'claude', 'codex']

export type CycleDirection = 'next' | 'prev'
export type CloseScope = 'others' | 'left' | 'right'
const DIRECTIONS: CycleDirection[] = ['next', 'prev']
const SCOPES: CloseScope[] = ['others', 'left', 'right']

export interface VoiceCommand {
  action: VoiceAction
  featureId?: string
  terminalId?: string
  groupId?: string
  kind?: TerminalKind
  prompt?: string
  name?: string
  gridStyle?: GridStyle
  direction?: CycleDirection
  scope?: CloseScope
  confidence: 'high' | 'low'
}

export interface SnapshotTerminal { id: string; name: string; kind: TerminalKind; hidden?: boolean }
export interface SnapshotFeature { id: string; name: string; terminals: SnapshotTerminal[] }
export interface SnapshotGroup { id: string; name: string; features: SnapshotFeature[] }
export interface WorkspaceSnapshot {
  groups: SnapshotGroup[]
  activeFeatureId: string | null
  activeTerminalId: string | null
}

// Progress/phase events streamed main → renderer while a command is processed.
export type VoiceStateEvent =
  | { phase: 'transcribing' }
  | { phase: 'parsing'; transcript: string }
  | { phase: 'downloading-model'; received: number; total: number | null }
  | { phase: 'error'; message: string; transcript?: string }

export interface VoiceResult { transcript: string; command: VoiceCommand }

const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

// Mouse side-button push-to-talk trigger; the UI-safe config subset the
// renderer is allowed to see (never the Groq key).
export type MouseTrigger = 'forward' | 'back' | 'off'
// 'hold' = push-to-talk (press records, release sends). 'click' = toggle —
// for mice whose firmware emits side-button press only on release (e.g.
// Logitech MX: held side button is the horizontal-scroll modifier).
export type MouseTriggerMode = 'hold' | 'click'
export interface VoiceUiConfig { mouseTrigger: MouseTrigger; mouseTriggerMode: MouseTriggerMode }

export function validateVoiceCommand(raw: unknown): VoiceCommand {
  if (typeof raw !== 'object' || raw === null) return { action: 'unknown', confidence: 'low' }
  const o = raw as Record<string, unknown>
  if (!VOICE_ACTIONS.includes(o.action as VoiceAction) || o.action === 'unknown') {
    return { action: 'unknown', confidence: 'low' }
  }
  const cmd: VoiceCommand = {
    action: o.action as VoiceAction,
    confidence: o.confidence === 'high' ? 'high' : 'low'
  }
  const featureId = str(o.featureId); if (featureId) cmd.featureId = featureId
  const terminalId = str(o.terminalId); if (terminalId) cmd.terminalId = terminalId
  const groupId = str(o.groupId); if (groupId) cmd.groupId = groupId
  if (KINDS.includes(o.kind as TerminalKind)) cmd.kind = o.kind as TerminalKind
  const prompt = str(o.prompt); if (prompt) cmd.prompt = prompt
  const name = str(o.name); if (name) cmd.name = name
  if (GRID_STYLES.includes(o.gridStyle as GridStyle)) cmd.gridStyle = o.gridStyle as GridStyle
  if (DIRECTIONS.includes(o.direction as CycleDirection)) cmd.direction = o.direction as CycleDirection
  if (SCOPES.includes(o.scope as CloseScope)) cmd.scope = o.scope as CloseScope
  return cmd
}

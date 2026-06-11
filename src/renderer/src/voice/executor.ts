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
import type { Feature, TerminalKind, ReviewStatus } from '@shared/types'
import type { VoiceCommand } from '@shared/voice'
import type { AgentKind } from '../agents'

export type StateDescriptor = {
  type: 'state'
  run: (s: AppState) => AppState
  toast: string
  // Terminal ids to markStarted() BEFORE apply — mirrors how existing handlers
  // gate spawning (see App.tsx onSelectTerminal / cycleTab).
  startIds?: string[]
}
// Review-loop control delegated to useReview via App (effectful, like
// closeTerminal/addTerminal — never reimplemented here).
export type ReviewDescriptor = {
  type: 'review'
  op: 'accept' | 'more-rounds' | 'stop'
  reviewerId: string
  toast: string
}
export type ExecDescriptor =
  | StateDescriptor
  | ReviewDescriptor
  | { type: 'closeTerminal'; terminalId: string }
  | { type: 'addTerminal'; featureId: string; kind: TerminalKind; name?: string; prompt?: string }
  | { type: 'sendPrompt'; terminalId: string; prompt: string }

// Live-process context the executor cannot derive from AppState: which
// terminals currently host a RUNNING agent (App tracks this from pty:proc
// events). REQUIRED parameter — an optional one would let stale call sites
// silently skip the liveness gate.
export interface PlanContext {
  liveAgents: Record<string, AgentKind | undefined>
  reviewStatus: Record<string, ReviewStatus | undefined>
}

export type ExecPlan =
  | { type: 'run'; descriptor: StateDescriptor | ReviewDescriptor }
  | { type: 'confirm'; summary: string; editablePrompt?: string; descriptor: ExecDescriptor }
  | { type: 'error'; message: string }

const findFeature = (s: AppState, id: string | undefined): Feature | null =>
  id ? s.workspace.groups.flatMap((g) => g.features).find((f) => f.id === id) ?? null : null

const err = (message: string): ExecPlan => ({ type: 'error', message })

export function planCommand(cmd: VoiceCommand, s: AppState, ctx: PlanContext): ExecPlan {
  const plan = planHigh(cmd, s, ctx)
  // Low LLM confidence: never run silently — show what was understood first.
  if (cmd.confidence === 'low' && plan.type === 'run') {
    return { type: 'confirm', summary: plan.descriptor.toast, descriptor: plan.descriptor }
  }
  return plan
}

function planHigh(cmd: VoiceCommand, s: AppState, ctx: PlanContext): ExecPlan {
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
    case 'send_prompt': {
      const id = cmd.terminalId ?? s.activeTerminalId
      const t = id ? getTerminalById(s, id) : null
      if (!t) return err('Terminal not found — try again')
      if (t.kind !== 'claude' && t.kind !== 'codex') {
        return err('Voice prompts can only go to claude/codex terminals')
      }
      if (!ctx.liveAgents[t.id]) {
        return err(`Agent is not running in "${t.name}" — say "add a claude terminal with prompt …" to start one`)
      }
      if (!cmd.prompt) return err('No prompt understood')
      const prompt = cmd.prompt
      return {
        type: 'confirm',
        summary: `Send to "${t.name}"`,
        editablePrompt: prompt,
        descriptor: { type: 'sendPrompt', terminalId: t.id, prompt }
      }
    }
    case 'review_accept':
    case 'review_more_rounds':
    case 'review_stop': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('No feature selected')
      const reviewer = f.terminals.find((t) => !!t.review)
      if (!reviewer) return err(`No review running in "${f.name}"`)
      // Accept/more-rounds are meaningful exactly when the loop paused for a
      // decision (the GUI shows those buttons only then — FeatureHeader):
      // mid-review, accept would tear down the reviewer and discard its
      // in-flight critique, and moreRounds would inject a second request into
      // the reviewer's PTY. Stop is always available, like the GUI's Stop.
      if (cmd.action !== 'review_stop' && ctx.reviewStatus[reviewer.id] !== 'needs-decision') {
        return err('Review is not waiting for a decision')
      }
      if (cmd.action === 'review_accept') {
        return {
          type: 'run',
          descriptor: { type: 'review', op: 'accept', reviewerId: reviewer.id, toast: `Review accepted: ${f.name}` }
        }
      }
      if (cmd.action === 'review_more_rounds') {
        return {
          type: 'run',
          descriptor: { type: 'review', op: 'more-rounds', reviewerId: reviewer.id, toast: `More review rounds: ${f.name}` }
        }
      }
      return {
        type: 'confirm',
        summary: `Stop the review in "${f.name}"`,
        descriptor: { type: 'review', op: 'stop', reviewerId: reviewer.id, toast: `Review stopped: ${f.name}` }
      }
    }
    // Batch-2 actions land in follow-up commits; the stub keeps the switch exhaustive.
    case 'cycle_tab': case 'close_tabs': case 'add_feature': case 'archive_feature':
      return err('Not supported yet')
    case 'unknown':
      return err("Didn't understand the command")
  }
}

// Executes an ExecDescriptor through App-provided dependencies. This is the
// delegation seam the spec requires: closeTerminal mirrors App's
// onDeleteTerminal branch (reviewer → review.stopLoop, else removeTerminal),
// addTerminal goes through the extracted launchAgent (sessionId pinning,
// codex session capture) — never reimplemented here.
import type { AppState } from '../store'
import { addTerminal, getTerminalById, removeTerminal } from '../store'
import type { AgentKind } from '../agents'
import type { ExecDescriptor } from './executor'

export interface RunDeps {
  state: AppState
  apply: (fn: (s: AppState) => AppState) => void
  markStarted: (id: string) => void
  stopReviewLoop: (terminalId: string) => void
  acceptPhase: (reviewerId: string) => void
  moreRounds: (reviewerId: string) => void
  launchAgent: (featureId: string, kind: AgentKind, opts?: { prompt?: string; name?: string }) => void
  // Injects a prompt into a live agent terminal's PTY (App implements it via
  // review/submit.ts submitToPty + inject.ts envelopePrompt).
  sendPrompt: (terminalId: string, prompt: string) => void
}

export function runDescriptor(d: ExecDescriptor, deps: RunDeps): void {
  if (d.type === 'state') {
    d.startIds?.forEach(deps.markStarted)
    deps.apply(d.run)
    return
  }
  if (d.type === 'review') {
    if (d.op === 'accept') deps.acceptPhase(d.reviewerId)
    else if (d.op === 'more-rounds') deps.moreRounds(d.reviewerId)
    else deps.stopReviewLoop(d.reviewerId)
    return
  }
  if (d.type === 'sendPrompt') {
    deps.sendPrompt(d.terminalId, d.prompt)
    return
  }
  if (d.type === 'closeTerminal') {
    const t = getTerminalById(deps.state, d.terminalId)
    if (t?.review) deps.stopReviewLoop(d.terminalId)
    else deps.apply((s) => removeTerminal(s, d.terminalId))
    return
  }
  if (d.type === 'addTerminal') {
    if (d.kind === 'shell') {
      deps.apply((s) => addTerminal(s, d.featureId, {
        name: d.name ?? 'shell',
        ...(d.prompt ? { startupCommand: d.prompt } : {})
      }))
      return
    }
    deps.launchAgent(d.featureId, d.kind, {
      ...(d.prompt ? { prompt: d.prompt } : {}),
      ...(d.name ? { name: d.name } : {})
    })
    return
  }
}

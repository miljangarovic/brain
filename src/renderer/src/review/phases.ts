import type { ReviewPhase } from '@shared/types'

export const PHASE_ORDER: ReviewPhase[] = ['intent', 'spec', 'impl']

export const PHASE_LABEL: Record<ReviewPhase, string> = {
  intent: 'Intent',
  spec: 'Spec/plan',
  impl: 'Implementation'
}

// The next phase in the pipeline, or null when `p` is the last one.
export function nextPhase(p: ReviewPhase): ReviewPhase | null {
  const i = PHASE_ORDER.indexOf(p)
  return i >= 0 && i < PHASE_ORDER.length - 1 ? PHASE_ORDER[i + 1] : null
}

// After the origin applies a NEEDS-WORK critique: iterate (bump round) unless the
// next round would exceed the cap, in which case stop for a user decision.
export function afterApply(round: number, maxRounds: number):
  | { type: 'iterate'; round: number }
  | { type: 'stop' } {
  return round + 1 > maxRounds ? { type: 'stop' } : { type: 'iterate', round: round + 1 }
}

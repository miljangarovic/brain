import type { ReviewLink, ReviewPhase } from '@shared/types'

// The file the reviewer writes for (phase, round), rebuilt renderer-side from a
// persisted link — used to re-arm verdict watches after a reload. Mirrors main's
// reviewFilePath (reviewFs.ts); forward slashes work on every supported platform.
export function reviewFileFor(link: Pick<ReviewLink, 'reviewDir' | 'phase' | 'round'>): string {
  return `${link.reviewDir}/review-${link.phase}-${link.round}.md`
}

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

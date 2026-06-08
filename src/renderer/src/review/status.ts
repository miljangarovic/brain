import type { ReviewStatus } from '@shared/types'

export type DotKind = 'spinner' | 'attention' | null

export function statusDot(status: ReviewStatus | undefined): DotKind {
  if (status === 'reviewing' || status === 'applying') return 'spinner'
  if (status === 'review-ready' || status === 'iteration-done') return 'attention'
  return null
}

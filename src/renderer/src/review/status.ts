import type { ReviewStatus } from '@shared/types'

export type DotKind = 'spinner' | 'attention' | 'active' | null

export function statusDot(status: ReviewStatus | undefined): DotKind {
  if (status === 'reviewing' || status === 'applying') return 'spinner'
  if (status === 'phase-approved' || status === 'needs-decision') return 'attention'
  if (status === 'under-review') return 'active'
  return null
}

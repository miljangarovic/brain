import type { ReviewStatus } from '@shared/types'
import { statusDot } from '../review/status'
import { SpinnerIcon } from './icons'

export function ReviewStatusDot({ status }: { status: ReviewStatus | undefined }) {
  const dot = statusDot(status)
  if (dot === null) return null
  if (dot === 'spinner') return <SpinnerIcon className="shrink-0 text-accent" />
  if (dot === 'active') return <span data-testid="review-active" title="Pod review-om" className="shrink-0 h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]" />
  return <span data-testid="review-attention" title="Pogledaj rezultat" className="shrink-0 h-2 w-2 rounded-full bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.7)]" />
}

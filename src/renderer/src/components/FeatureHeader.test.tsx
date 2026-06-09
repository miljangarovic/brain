import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeatureHeader } from './FeatureHeader'

const noReview = { reviewerId: null, needsDecision: false, active: false }
const base = {
  featureName: 'auth', viewMode: 'tabs' as const, onToggleView: vi.fn(), onAdd: vi.fn(),
  onMoreRounds: vi.fn(), onAcceptPhase: vi.fn(), onStopLoop: vi.fn()
}

describe('FeatureHeader', () => {
  it('shows the feature name and the grid toggle', () => {
    render(<FeatureHeader {...base} review={noReview} />)
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument()
  })

  it('grid toggle calls onToggleView', () => {
    const onToggleView = vi.fn()
    render(<FeatureHeader {...base} onToggleView={onToggleView} review={noReview} />)
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(onToggleView).toHaveBeenCalled()
  })

  it('shows "Stani petlju" while the loop is active', () => {
    const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onStopLoop={onStopLoop} review={{ ...noReview, reviewerId: 'b', active: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stani petlju' }))
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })

  it('shows the three decision buttons on needs-decision', () => {
    const onMoreRounds = vi.fn(); const onAcceptPhase = vi.fn(); const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onMoreRounds={onMoreRounds} onAcceptPhase={onAcceptPhase} onStopLoop={onStopLoop}
      review={{ ...noReview, reviewerId: 'b', needsDecision: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Još rundi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prihvati ovako' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onMoreRounds).toHaveBeenCalledWith('b')
    expect(onAcceptPhase).toHaveBeenCalledWith('b')
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })
})

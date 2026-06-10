import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeatureHeader } from './FeatureHeader'

const noReview = { reviewerId: null, needsDecision: false, active: false }
const base = {
  featureName: 'auth', viewMode: 'tabs' as const, onToggleView: vi.fn(), onAdd: vi.fn(),
  onMoreRounds: vi.fn(), onAcceptPhase: vi.fn(), onStopLoop: vi.fn(),
  gridStyle: 'auto' as const, onSetGridStyle: vi.fn()
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

  it('shows the grid layout picker only in grid mode', () => {
    const { rerender } = render(<FeatureHeader {...base} review={noReview} />)
    expect(screen.queryByRole('button', { name: 'Stack vertically' })).not.toBeInTheDocument()
    rerender(<FeatureHeader {...base} viewMode="grid" review={noReview} />)
    expect(screen.getByRole('button', { name: 'Big pane left' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Big pane right' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stack vertically' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Side by side' })).toBeInTheDocument()
  })

  it('clicking a layout option reports the chosen style', () => {
    const onSetGridStyle = vi.fn()
    render(<FeatureHeader {...base} viewMode="grid" onSetGridStyle={onSetGridStyle} review={noReview} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stack vertically' }))
    expect(onSetGridStyle).toHaveBeenCalledWith('rows')
    fireEvent.click(screen.getByRole('button', { name: 'Big pane left' }))
    expect(onSetGridStyle).toHaveBeenCalledWith('auto-left')
  })

  it('marks the active layout option as pressed', () => {
    render(<FeatureHeader {...base} viewMode="grid" gridStyle="rows" review={noReview} />)
    expect(screen.getByRole('button', { name: 'Stack vertically' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows "Zaustavi petlju" while the loop is active', () => {
    const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onStopLoop={onStopLoop} review={{ ...noReview, reviewerId: 'b', active: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zaustavi petlju' }))
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })

  it('shows the three decision buttons on needs-decision', () => {
    const onMoreRounds = vi.fn(); const onAcceptPhase = vi.fn(); const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onMoreRounds={onMoreRounds} onAcceptPhase={onAcceptPhase} onStopLoop={onStopLoop}
      review={{ ...noReview, reviewerId: 'b', needsDecision: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nastavi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prihvati' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zaustavi petlju' }))
    expect(onMoreRounds).toHaveBeenCalledWith('b')
    expect(onAcceptPhase).toHaveBeenCalledWith('b')
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })
})

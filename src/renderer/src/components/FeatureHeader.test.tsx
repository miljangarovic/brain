import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeatureHeader } from './FeatureHeader'

const base = {
  featureName: 'auth', viewMode: 'tabs' as const, onToggleView: vi.fn(), onAdd: vi.fn(),
  onMoreRounds: vi.fn(), onAcceptPhase: vi.fn(), onStopLoop: vi.fn(),
  gridStyle: 'auto' as const, onSetGridStyle: vi.fn()
}

describe('FeatureHeader', () => {
  it('shows the feature name and the grid toggle', () => {
    render(<FeatureHeader {...base} reviews={[]} />)
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeInTheDocument()
  })

  it('grid toggle calls onToggleView', () => {
    const onToggleView = vi.fn()
    render(<FeatureHeader {...base} onToggleView={onToggleView} reviews={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(onToggleView).toHaveBeenCalled()
  })

  it('keeps the grid toggle as the FIRST control, whatever else is shown', () => {
    // Busiest case: review decision buttons + grid-style picker all visible.
    render(<FeatureHeader {...base} viewMode="grid" reviews={[{ reviewerId: 'b', kind: 'codex' as const, needsDecision: true, active: false }]} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveAccessibleName('Tabs view')
  })

  it('shows the grid layout picker only in grid mode', () => {
    const { rerender } = render(<FeatureHeader {...base} reviews={[]} />)
    expect(screen.queryByRole('button', { name: 'Stack vertically' })).not.toBeInTheDocument()
    rerender(<FeatureHeader {...base} viewMode="grid" reviews={[]} />)
    expect(screen.getByRole('button', { name: 'Big pane left' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Big pane right' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Big pane top' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Big pane bottom' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stack vertically' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Side by side' })).toBeInTheDocument()
  })

  it('clicking a layout option reports the chosen style', () => {
    const onSetGridStyle = vi.fn()
    render(<FeatureHeader {...base} viewMode="grid" onSetGridStyle={onSetGridStyle} reviews={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stack vertically' }))
    expect(onSetGridStyle).toHaveBeenCalledWith('rows')
    fireEvent.click(screen.getByRole('button', { name: 'Big pane left' }))
    expect(onSetGridStyle).toHaveBeenCalledWith('auto-left')
    fireEvent.click(screen.getByRole('button', { name: 'Big pane top' }))
    expect(onSetGridStyle).toHaveBeenCalledWith('auto-top')
    fireEvent.click(screen.getByRole('button', { name: 'Big pane bottom' }))
    expect(onSetGridStyle).toHaveBeenCalledWith('auto-bottom')
  })

  it('marks the active layout option as pressed', () => {
    render(<FeatureHeader {...base} viewMode="grid" gridStyle="rows" reviews={[]} />)
    expect(screen.getByRole('button', { name: 'Stack vertically' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows "Stop loop" while the loop is active', () => {
    const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onStopLoop={onStopLoop} reviews={[{ reviewerId: 'b', kind: 'codex' as const, needsDecision: false, active: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop loop' }))
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })

  it('shows the three decision buttons on needs-decision', () => {
    const onMoreRounds = vi.fn(); const onAcceptPhase = vi.fn(); const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onMoreRounds={onMoreRounds} onAcceptPhase={onAcceptPhase} onStopLoop={onStopLoop}
      reviews={[{ reviewerId: 'b', kind: 'codex' as const, needsDecision: true, active: false }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop loop' }))
    expect(onMoreRounds).toHaveBeenCalledWith('b')
    expect(onAcceptPhase).toHaveBeenCalledWith('b')
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })

  it('renders one control cluster per reviewer and routes clicks by reviewer id', () => {
    const onStopLoop = vi.fn()
    render(<FeatureHeader {...base} onStopLoop={onStopLoop} reviews={[
      { reviewerId: 'a', kind: 'claude', needsDecision: false, active: true },
      { reviewerId: 'b', kind: 'codex', needsDecision: false, active: true }
    ]} />)
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.getByText('codex')).toBeInTheDocument()
    const stops = screen.getAllByRole('button', { name: 'Stop loop' })
    expect(stops).toHaveLength(2)
    fireEvent.click(stops[1])
    expect(onStopLoop).toHaveBeenCalledWith('b')
  })
})

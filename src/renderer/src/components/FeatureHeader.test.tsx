import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeatureHeader } from './FeatureHeader'

const noRelay = { canReturn: false, canReReview: false, canMarkApplied: false }
const base = {
  featureName: 'auth', viewMode: 'tabs' as const,
  onToggleView: () => {}, onAdd: () => {},
  relay: noRelay, onReturnToOrigin: () => {}, onReReview: () => {}, onMarkApplied: () => {}
}

describe('FeatureHeader', () => {
  it('shows the feature name', () => {
    render(<FeatureHeader {...base} />)
    expect(screen.getByText('auth')).toBeInTheDocument()
  })
  it('grid button calls onToggleView', () => {
    const onToggleView = vi.fn()
    render(<FeatureHeader {...base} onToggleView={onToggleView} />)
    fireEvent.click(screen.getByLabelText('Grid prikaz'))
    expect(onToggleView).toHaveBeenCalled()
  })
  it('add menu calls onAdd with the kind', () => {
    const onAdd = vi.fn()
    render(<FeatureHeader {...base} onAdd={onAdd} />)
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Codex' }))
    expect(onAdd).toHaveBeenCalledWith('codex')
  })
  it('shows relay buttons only when flagged and wires them', () => {
    const onReturnToOrigin = vi.fn()
    const { rerender } = render(<FeatureHeader {...base} />)
    expect(screen.queryByText('→ Vrati u A')).toBeNull()
    rerender(<FeatureHeader {...base} relay={{ ...noRelay, canReturn: true }} onReturnToOrigin={onReturnToOrigin} />)
    fireEvent.click(screen.getByText('→ Vrati u A'))
    expect(onReturnToOrigin).toHaveBeenCalled()
  })
})

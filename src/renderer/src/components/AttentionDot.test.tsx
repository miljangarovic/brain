import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AttentionDot } from './AttentionDot'

describe('AttentionDot', () => {
  it('renders nothing when there is no attention', () => {
    const { container } = render(<AttentionDot state={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('renders an amber dot for waiting-input', () => {
    render(<AttentionDot state="waiting-input" />)
    expect(screen.getByTestId('attn-waiting')).toBeInTheDocument()
  })
  it('renders a blue dot for done', () => {
    render(<AttentionDot state="done" />)
    expect(screen.getByTestId('attn-done')).toBeInTheDocument()
  })
  it('renders a red dot for error', () => {
    render(<AttentionDot state="error" />)
    expect(screen.getByTestId('attn-error')).toBeInTheDocument()
  })
})

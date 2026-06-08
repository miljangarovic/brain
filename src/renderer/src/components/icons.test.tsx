import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalKindIcon } from './icons'

describe('TerminalKindIcon', () => {
  it('renders the matching icon per kind', () => {
    const { rerender } = render(<TerminalKindIcon kind="claude" />)
    expect(screen.getByTestId('icon-claude')).toBeInTheDocument()
    rerender(<TerminalKindIcon kind="codex" />)
    expect(screen.getByTestId('icon-codex')).toBeInTheDocument()
    rerender(<TerminalKindIcon kind="shell" />)
    expect(screen.getByTestId('icon-shell')).toBeInTheDocument()
  })
})

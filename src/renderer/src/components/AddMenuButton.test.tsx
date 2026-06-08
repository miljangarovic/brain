import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { AddMenuButton } from './AddMenuButton'

describe('AddMenuButton', () => {
  it('opens a menu with Claude/Codex/Terminal; Claude → onAdd("claude")', () => {
    const onAdd = vi.fn()
    render(<AddMenuButton onAdd={onAdd} />)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Claude' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Codex' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Terminal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Claude' }))
    expect(onAdd).toHaveBeenCalledWith('claude')
  })

  it('Codex → onAdd("codex"), Terminal → onAdd("shell")', () => {
    const onAdd = vi.fn()
    const { rerender } = render(<AddMenuButton onAdd={onAdd} />)
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Codex' }))
    expect(onAdd).toHaveBeenCalledWith('codex')
    onAdd.mockClear()
    rerender(<AddMenuButton onAdd={onAdd} />)
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }))
    expect(onAdd).toHaveBeenCalledWith('shell')
  })

  it('uses a custom aria-label when provided', () => {
    render(<AddMenuButton onAdd={vi.fn()} label="Dodaj u auth" />)
    expect(screen.getByLabelText('Dodaj u auth')).toBeInTheDocument()
  })

  it('Claude and Codex items show their brand icons', () => {
    render(<AddMenuButton onAdd={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    expect(within(screen.getByRole('menuitem', { name: 'Claude' })).getByTestId('icon-claude')).toBeInTheDocument()
    expect(within(screen.getByRole('menuitem', { name: 'Codex' })).getByTestId('icon-codex')).toBeInTheDocument()
  })
})

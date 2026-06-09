import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AttentionBell, type AttentionBellItem } from './AttentionBell'

const items: AttentionBellItem[] = [
  { terminalId: 'a', state: 'waiting-input', lastLine: 'Proceed? (y/n)', path: 'p › f › claude' },
  { terminalId: 'b', state: 'error', lastLine: 'exit 1', path: 'p › f › codex' },
]
const base = {
  items, muted: false,
  onSelect: vi.fn(), onClear: vi.fn(), onClearAll: vi.fn(), onToggleMute: vi.fn(),
}

describe('AttentionBell', () => {
  it('shows the count of waiting terminals', () => {
    render(<AttentionBell {...base} />)
    expect(screen.getByLabelText(/2 terminal/i)).toBeInTheDocument()
  })
  it('opens the popover and lists items by path', () => {
    render(<AttentionBell {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    expect(screen.getByText('p › f › claude')).toBeInTheDocument()
    expect(screen.getByText('p › f › codex')).toBeInTheDocument()
  })
  it('selecting an item calls onSelect with its terminal id', () => {
    const onSelect = vi.fn()
    render(<AttentionBell {...base} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    fireEvent.click(screen.getByText('p › f › claude'))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
  it('clear-all calls onClearAll', () => {
    const onClearAll = vi.fn()
    render(<AttentionBell {...base} onClearAll={onClearAll} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(onClearAll).toHaveBeenCalled()
  })
  it('mute toggle calls onToggleMute', () => {
    const onToggleMute = vi.fn()
    render(<AttentionBell {...base} onToggleMute={onToggleMute} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    fireEvent.click(screen.getByRole('button', { name: /mute|unmute/i }))
    expect(onToggleMute).toHaveBeenCalled()
  })
  it('closes the popover when Escape is pressed', () => {
    render(<AttentionBell {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /attention/i }))
    expect(screen.getByText('p › f › claude')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('p › f › claude')).not.toBeInTheDocument()
  })
})

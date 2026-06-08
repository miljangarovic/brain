// src/renderer/src/components/TabBar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'
import type { Terminal } from '@shared/types'

const terms: Terminal[] = [
  { id: 'a', name: 'claude-api', cwd: '' },
  { id: 'b', name: 'tests', cwd: '' }
]

describe('TabBar', () => {
  it('renders a tab per terminal and marks the active one', () => {
    render(<TabBar terminals={terms} activeId="a" onSelect={() => {}} onClose={() => {}} onAdd={() => {}} />)
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.getByText('tests')).toBeInTheDocument()
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('claude-api')
  })

  it('calls onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={onSelect} onClose={() => {}} onAdd={() => {}} />)
    await userEvent.click(screen.getByText('tests'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('calls onClose without selecting when the × is clicked', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={onSelect} onClose={onClose} onAdd={() => {}} />)
    await userEvent.click(screen.getByLabelText('Zatvori tests'))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('calls onAdd when + is clicked', async () => {
    const onAdd = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={() => {}} onClose={() => {}} onAdd={onAdd} />)
    await userEvent.click(screen.getByLabelText('Novi terminal'))
    expect(onAdd).toHaveBeenCalled()
  })
})

// src/renderer/src/components/TabBar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'
import type { Terminal } from '@shared/types'

const terms: Terminal[] = [
  { id: 'a', name: 'claude-api', cwd: '' },
  { id: 'b', name: 'tests', cwd: '' }
]
function noop() {}

describe('TabBar', () => {
  it('renders a tab per terminal and marks the active one', () => {
    render(<TabBar terminals={terms} activeId="a" onSelect={noop} onClose={noop} onAdd={noop} onLaunch={noop} />)
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.getByText('tests')).toBeInTheDocument()
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('claude-api')
  })

  it('calls onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={onSelect} onClose={noop} onAdd={noop} onLaunch={noop} />)
    await userEvent.click(screen.getByText('tests'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('calls onClose without selecting when the × is clicked', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={onSelect} onClose={onClose} onAdd={noop} onLaunch={noop} />)
    await userEvent.click(screen.getByLabelText('Zatvori tests'))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('calls onAdd when + is clicked', async () => {
    const onAdd = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={noop} onClose={noop} onAdd={onAdd} onLaunch={noop} />)
    await userEvent.click(screen.getByLabelText('Novi terminal'))
    expect(onAdd).toHaveBeenCalled()
  })

  it('launches an agent via its quick button', async () => {
    const onLaunch = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={noop} onClose={noop} onAdd={noop} onLaunch={onLaunch} />)
    await userEvent.click(screen.getByLabelText('Novi Claude terminal'))
    expect(onLaunch).toHaveBeenCalledWith('claude')
    await userEvent.click(screen.getByLabelText('Novi Codex terminal'))
    expect(onLaunch).toHaveBeenCalledWith('codex')
  })

  it('shows the kind icon on an agent tab', () => {
    const agentTerms: Terminal[] = [{ id: 'a', name: 'claude', cwd: '', kind: 'claude' }]
    render(<TabBar terminals={agentTerms} activeId="a" onSelect={noop} onClose={noop} onAdd={noop} onLaunch={noop} />)
    const tab = screen.getByRole('tab')
    expect(within(tab).getByTestId('icon-claude')).toBeInTheDocument()
  })
})

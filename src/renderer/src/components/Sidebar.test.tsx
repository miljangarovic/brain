import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Group } from '@shared/types'

const groups: Group[] = [
  { id: 'g1', name: 'feature-auth', collapsed: false, terminals: [
    { id: 't1', name: 'claude-api', cwd: '' }
  ] },
  { id: 'g2', name: 'devops', collapsed: true, terminals: [
    { id: 't2', name: 'deploy', cwd: '' }
  ] }
]

function noop() {}

describe('Sidebar', () => {
  it('renders groups and the terminals of expanded groups only', () => {
    render(<Sidebar groups={groups} activeTerminalId="t1"
      onSelectTerminal={noop} onToggleGroup={noop} onAddGroup={noop} onAddTerminal={noop} onDeleteGroup={noop} />)
    expect(screen.getByText('feature-auth')).toBeInTheDocument()
    expect(screen.getByText('claude-api')).toBeInTheDocument()  // g1 expanded
    expect(screen.queryByText('deploy')).not.toBeInTheDocument() // g2 collapsed
  })

  it('selects a terminal on click', async () => {
    const onSelectTerminal = vi.fn()
    render(<Sidebar groups={groups} activeTerminalId={null}
      onSelectTerminal={onSelectTerminal} onToggleGroup={noop} onAddGroup={noop} onAddTerminal={noop} onDeleteGroup={noop} />)
    await userEvent.click(screen.getByText('claude-api'))
    expect(onSelectTerminal).toHaveBeenCalledWith('t1')
  })

  it('toggles a group when its caret is clicked', async () => {
    const onToggleGroup = vi.fn()
    render(<Sidebar groups={groups} activeTerminalId={null}
      onSelectTerminal={noop} onToggleGroup={onToggleGroup} onAddGroup={noop} onAddTerminal={noop} onDeleteGroup={noop} />)
    await userEvent.click(screen.getByLabelText('Skupi/raširi feature-auth'))
    expect(onToggleGroup).toHaveBeenCalledWith('g1')
  })

  it('adds a group from the input on Enter', async () => {
    const onAddGroup = vi.fn()
    render(<Sidebar groups={groups} activeTerminalId={null}
      onSelectTerminal={noop} onToggleGroup={noop} onAddGroup={onAddGroup} onAddTerminal={noop} onDeleteGroup={noop} />)
    const input = screen.getByPlaceholderText('Nova grupa…')
    await userEvent.type(input, 'feature-ui{Enter}')
    expect(onAddGroup).toHaveBeenCalledWith('feature-ui')
  })

  it('requests a new terminal for a group', async () => {
    const onAddTerminal = vi.fn()
    render(<Sidebar groups={groups} activeTerminalId={null}
      onSelectTerminal={noop} onToggleGroup={noop} onAddGroup={noop} onAddTerminal={onAddTerminal} onDeleteGroup={noop} />)
    await userEvent.click(screen.getByLabelText('Novi terminal u feature-auth'))
    expect(onAddTerminal).toHaveBeenCalledWith('g1')
  })
})

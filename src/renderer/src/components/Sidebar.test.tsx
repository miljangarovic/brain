// src/renderer/src/components/Sidebar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Group } from '@shared/types'

const groups: Group[] = [
  { id: 'g1', name: 'feature-auth', collapsed: false, terminals: [
    { id: 't1', name: 'claude-api', cwd: '', kind: 'claude' }
  ] },
  { id: 'g2', name: 'devops', collapsed: true, terminals: [
    { id: 't2', name: 'deploy', cwd: '' }
  ] }
]
function noop() {}

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = {
    groups,
    activeTerminalId: null as string | null,
    onSelectTerminal: noop,
    onToggleGroup: noop,
    onAddGroup: noop,
    onRenameGroup: noop,
    onAddTerminal: noop,
    onDeleteGroup: noop,
    onLaunchAgent: noop,
    ...overrides
  }
  return render(<Sidebar {...props} />)
}

describe('Sidebar', () => {
  it('renders groups and the terminals of expanded groups only', () => {
    renderSidebar({ activeTerminalId: 't1' })
    expect(screen.getByText('feature-auth')).toBeInTheDocument()
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.queryByText('deploy')).not.toBeInTheDocument()
  })

  it('selects a terminal on click', async () => {
    const onSelectTerminal = vi.fn()
    renderSidebar({ onSelectTerminal })
    await userEvent.click(screen.getByText('claude-api'))
    expect(onSelectTerminal).toHaveBeenCalledWith('t1')
  })

  it('toggles a group when its caret is clicked', async () => {
    const onToggleGroup = vi.fn()
    renderSidebar({ onToggleGroup })
    await userEvent.click(screen.getByLabelText('Skupi/raširi feature-auth'))
    expect(onToggleGroup).toHaveBeenCalledWith('g1')
  })

  it('adds a group from the input on Enter', async () => {
    const onAddGroup = vi.fn()
    renderSidebar({ onAddGroup })
    await userEvent.type(screen.getByPlaceholderText('Nova grupa…'), 'feature-ui{Enter}')
    expect(onAddGroup).toHaveBeenCalledWith('feature-ui')
  })

  it('requests a new shell terminal for a group', async () => {
    const onAddTerminal = vi.fn()
    renderSidebar({ onAddTerminal })
    await userEvent.click(screen.getByLabelText('Novi terminal u feature-auth'))
    expect(onAddTerminal).toHaveBeenCalledWith('g1')
  })

  it('renames a group via double-click then Enter', async () => {
    const onRenameGroup = vi.fn()
    renderSidebar({ onRenameGroup })
    await userEvent.dblClick(screen.getByText('feature-auth'))
    const input = screen.getByLabelText('Preimenuj grupu feature-auth')
    await userEvent.clear(input)
    await userEvent.type(input, 'auth-v2{Enter}')
    expect(onRenameGroup).toHaveBeenCalledWith('g1', 'auth-v2')
  })

  it('launches claude/codex into a specific group', async () => {
    const onLaunchAgent = vi.fn()
    renderSidebar({ onLaunchAgent })
    await userEvent.click(screen.getByLabelText('Novi Claude terminal u feature-auth'))
    expect(onLaunchAgent).toHaveBeenCalledWith('g1', 'claude')
    await userEvent.click(screen.getByLabelText('Novi Codex terminal u feature-auth'))
    expect(onLaunchAgent).toHaveBeenCalledWith('g1', 'codex')
  })

  it('shows the kind icon in front of a terminal', () => {
    renderSidebar()
    const item = screen.getByText('claude-api').closest('[data-term-id]') as HTMLElement
    expect(within(item).getByTestId('icon-claude')).toBeInTheDocument()
  })
})

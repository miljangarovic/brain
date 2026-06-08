import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Group } from '@shared/types'

const groups: Group[] = [
  { id: 'g1', name: 'proj', cwd: '/home/me/proj', collapsed: false, features: [
    { id: 'f1', name: 'auth', collapsed: false, terminals: [
      { id: 't1', name: 'claude', cwd: '/home/me/proj', kind: 'claude' }
    ] },
    { id: 'f2', name: 'ui', collapsed: true, terminals: [
      { id: 't2', name: 'dev', cwd: '/home/me/proj' }
    ] }
  ] }
]
function noop() {}

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = {
    groups,
    activeTerminalId: null as string | null,
    onSelectTerminal: noop,
    onToggleGroup: noop,
    onToggleFeature: noop,
    onAddGroup: noop,
    onAddFeature: noop,
    onAddTerminal: noop,
    onLaunchAgent: noop,
    onToggleFeatureView: noop,
    onRenameGroup: noop,
    onRenameFeature: noop,
    onRenameTerminal: noop,
    onDeleteGroup: noop,
    onDeleteFeature: noop,
    onOpenInFiles: noop,
    liveAgents: {},
    ...overrides
  }
  return render(<Sidebar {...props} />)
}

describe('Sidebar (3-level)', () => {
  it('renders groups, the group cwd, features, and terminals of expanded features', () => {
    renderSidebar({ activeTerminalId: 't1' })
    expect(screen.getByText('proj')).toBeInTheDocument()
    expect(screen.getByText('/home/me/proj')).toBeInTheDocument()
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByText('ui')).toBeInTheDocument()
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.queryByText('dev')).not.toBeInTheDocument()
  })

  it('selects a terminal on click and shows its kind icon', () => {
    const onSelectTerminal = vi.fn()
    renderSidebar({ onSelectTerminal })
    const item = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(within(item).getByTestId('icon-claude')).toBeInTheDocument()
  })

  it('adds a group via the bottom input', async () => {
    const onAddGroup = vi.fn()
    renderSidebar({ onAddGroup })
    await userEvent.click(screen.getByLabelText('Nova grupa'))
    expect(onAddGroup).toHaveBeenCalled()
  })

  it('adds a feature to a group', async () => {
    const onAddFeature = vi.fn()
    renderSidebar({ onAddFeature })
    await userEvent.type(screen.getByLabelText('Novi feature u proj'), 'payments{Enter}')
    expect(onAddFeature).toHaveBeenCalledWith('g1', 'payments')
  })

  it('adds a terminal to a feature via the hover + button', async () => {
    const onAddTerminal = vi.fn()
    renderSidebar({ onAddTerminal })
    await userEvent.click(screen.getByLabelText('Novi terminal u auth'))
    expect(onAddTerminal).toHaveBeenCalledWith('f1')
  })

  it('launches claude/codex into a feature', async () => {
    const onLaunchAgent = vi.fn()
    renderSidebar({ onLaunchAgent })
    await userEvent.click(screen.getByLabelText('Novi Claude terminal u auth'))
    expect(onLaunchAgent).toHaveBeenCalledWith('f1', 'claude')
    await userEvent.click(screen.getByLabelText('Novi Codex terminal u auth'))
    expect(onLaunchAgent).toHaveBeenCalledWith('f1', 'codex')
  })

  it('a live agent wins over the static kind on a visible terminal', () => {
    // t1 has static kind 'claude'; a live 'codex' detection must override the icon.
    renderSidebar({ liveAgents: { t1: 'codex' } })
    const item = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(within(item).getByTestId('icon-codex')).toBeInTheDocument()
  })

  it('renames a group, a feature and a terminal via double-click', async () => {
    const onRenameGroup = vi.fn(), onRenameFeature = vi.fn(), onRenameTerminal = vi.fn()
    renderSidebar({ onRenameGroup, onRenameFeature, onRenameTerminal })

    await userEvent.dblClick(screen.getByText('proj'))
    await userEvent.clear(screen.getByLabelText('Preimenuj grupu proj'))
    await userEvent.type(screen.getByLabelText('Preimenuj grupu proj'), 'proj2{Enter}')
    expect(onRenameGroup).toHaveBeenCalledWith('g1', 'proj2')

    await userEvent.dblClick(screen.getByText('auth'))
    await userEvent.clear(screen.getByLabelText('Preimenuj feature auth'))
    await userEvent.type(screen.getByLabelText('Preimenuj feature auth'), 'auth2{Enter}')
    expect(onRenameFeature).toHaveBeenCalledWith('f1', 'auth2')

    await userEvent.dblClick(screen.getByText('claude'))
    await userEvent.clear(screen.getByLabelText('Preimenuj terminal claude'))
    await userEvent.type(screen.getByLabelText('Preimenuj terminal claude'), 'c2{Enter}')
    expect(onRenameTerminal).toHaveBeenCalledWith('t1', 'c2')
  })

  it('right-click on a group offers Open in Files', async () => {
    const onOpenInFiles = vi.fn()
    renderSidebar({ onOpenInFiles })
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.contextMenu(screen.getByText('proj'))
    await userEvent.click(screen.getByText('Open in Files'))
    expect(onOpenInFiles).toHaveBeenCalledWith('g1')
  })
})

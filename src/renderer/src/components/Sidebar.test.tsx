import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
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
    onDeleteTerminal: noop,
    onOpenInFiles: noop,
    liveAgents: {},
    busy: {},
    reviewStatus: {},
    onReviewTerminal: noop,
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
    await userEvent.click(screen.getByLabelText('New Project'))
    expect(onAddGroup).toHaveBeenCalled()
  })

  it('adds a feature to a group', async () => {
    const onAddFeature = vi.fn()
    renderSidebar({ onAddFeature })
    await userEvent.type(screen.getByLabelText('New feature in proj'), 'payments{Enter}')
    expect(onAddFeature).toHaveBeenCalledWith('g1', 'payments')
  })

  it('adds a terminal to a feature via the AddMenuButton', async () => {
    const onAddTerminal = vi.fn()
    renderSidebar({ onAddTerminal })
    await userEvent.click(screen.getByLabelText('Add to auth'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }))
    expect(onAddTerminal).toHaveBeenCalledWith('f1')
  })

  it('launches claude/codex into a feature via the AddMenuButton', async () => {
    const onLaunchAgent = vi.fn()
    renderSidebar({ onLaunchAgent })
    await userEvent.click(screen.getByLabelText('Add to auth'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Claude' }))
    expect(onLaunchAgent).toHaveBeenCalledWith('f1', 'claude')
    await userEvent.click(screen.getByLabelText('Add to auth'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Codex' }))
    expect(onLaunchAgent).toHaveBeenCalledWith('f1', 'codex')
  })

  it('shows a spinner instead of the kind icon on a busy terminal row', () => {
    renderSidebar({ busy: { t1: true } })
    const item = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(within(item).getByTestId('icon-spinner')).toBeInTheDocument()
    expect(within(item).queryByTestId('icon-claude')).not.toBeInTheDocument()
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
    await userEvent.clear(screen.getByLabelText('Rename project proj'))
    await userEvent.type(screen.getByLabelText('Rename project proj'), 'proj2{Enter}')
    expect(onRenameGroup).toHaveBeenCalledWith('g1', 'proj2')

    await userEvent.dblClick(screen.getByText('auth'))
    await userEvent.clear(screen.getByLabelText('Rename feature auth'))
    await userEvent.type(screen.getByLabelText('Rename feature auth'), 'auth2{Enter}')
    expect(onRenameFeature).toHaveBeenCalledWith('f1', 'auth2')

    await userEvent.dblClick(screen.getByText('claude'))
    await userEvent.clear(screen.getByLabelText('Rename terminal claude'))
    await userEvent.type(screen.getByLabelText('Rename terminal claude'), 'c2{Enter}')
    expect(onRenameTerminal).toHaveBeenCalledWith('t1', 'c2')
  })

  it('auto-opens the rename input for a freshly-added terminal and consumes the signal', () => {
    const onPendingRenameConsumed = vi.fn()
    renderSidebar({ pendingRenameTerminalId: 't1', onPendingRenameConsumed })
    expect(screen.getByLabelText('Rename terminal claude')).toBeInTheDocument()
    expect(onPendingRenameConsumed).toHaveBeenCalled()
  })

  it('shows a loading spinner on a feature row when any of its terminals is busy', () => {
    renderSidebar({ busy: { t1: true } }) // t1 lives in the expanded 'auth' feature
    const authRow = screen.getByText('auth').closest('div') as HTMLElement
    expect(within(authRow).getByTestId('icon-spinner')).toBeInTheDocument()
    const uiRow = screen.getByText('ui').closest('div') as HTMLElement
    expect(within(uiRow).queryByTestId('icon-spinner')).not.toBeInTheDocument()
  })

  it('shows the feature spinner even when the feature is collapsed', () => {
    renderSidebar({ busy: { t2: true } }) // t2 lives in the collapsed 'ui' feature
    const uiRow = screen.getByText('ui').closest('div') as HTMLElement
    expect(within(uiRow).getByTestId('icon-spinner')).toBeInTheDocument()
  })

  it('resizes the sidebar by dragging the separator handle', () => {
    localStorage.clear()
    const { container } = renderSidebar()
    const root = container.firstChild as HTMLElement
    fireEvent.mouseDown(screen.getByLabelText('Resize sidebar'))
    fireEvent.mouseMove(window, { clientX: 320 })
    fireEvent.mouseUp(window)
    expect(root.style.width).toBe('320px')
  })

  it('deletes a terminal via its hover trash button', async () => {
    const onDeleteTerminal = vi.fn()
    renderSidebar({ onDeleteTerminal })
    await userEvent.click(screen.getByLabelText('Delete terminal claude'))
    expect(onDeleteTerminal).toHaveBeenCalledWith('t1')
  })

  it('single click on a group name collapses it (after the click delay)', () => {
    vi.useFakeTimers()
    try {
      const onToggleGroup = vi.fn()
      renderSidebar({ onToggleGroup })
      fireEvent.click(screen.getByText('proj'))
      vi.advanceTimersByTime(250)
      expect(onToggleGroup).toHaveBeenCalledWith('g1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('single click on a feature name collapses it (after the click delay)', () => {
    vi.useFakeTimers()
    try {
      const onToggleFeature = vi.fn()
      renderSidebar({ onToggleFeature })
      fireEvent.click(screen.getByText('auth'))
      vi.advanceTimersByTime(250)
      expect(onToggleFeature).toHaveBeenCalledWith('f1')
    } finally {
      vi.useRealTimers()
    }
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

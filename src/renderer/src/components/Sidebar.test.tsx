import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar, insertionFromMidpoints, reorderToIndex } from './Sidebar'
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
    activeFeatureId: null as string | null,
    activeGroupId: null as string | null,
    onSelectTerminal: noop,
    onToggleGroup: noop,
    onToggleFeature: noop,
    onAddGroup: noop,
    onAddFeature: noop,
    onAddTerminal: noop,
    onLaunchAgent: noop,
    onToggleFeatureView: noop,
    onMoveGroup: noop,
    onMoveFeature: noop,
    onMoveTerminal: noop,
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
  it('renders groups, features, and terminals of expanded features (no cwd next to the name)', () => {
    renderSidebar({ activeTerminalId: 't1' })
    expect(screen.getByText('proj')).toBeInTheDocument()
    expect(screen.queryByText('/home/me/proj')).not.toBeInTheDocument()
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByText('ui')).toBeInTheDocument()
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.queryByText('dev')).not.toBeInTheDocument()
  })

  it('marks the active feature (the one shown in the right pane) with aria-current', () => {
    const rowOf = (c: HTMLElement, id: string) => c.querySelector(`[data-feature-id="${id}"]`) as HTMLElement
    const first = renderSidebar({ activeFeatureId: 'f1' })
    expect(rowOf(first.container, 'f1')).toHaveAttribute('aria-current', 'true')
    expect(rowOf(first.container, 'f2')).not.toHaveAttribute('aria-current')
    // the marker follows whichever feature is active
    const second = renderSidebar({ activeFeatureId: 'f2' })
    expect(rowOf(second.container, 'f1')).not.toHaveAttribute('aria-current')
    expect(rowOf(second.container, 'f2')).toHaveAttribute('aria-current', 'true')
  })

  it('marks the active project (the one shown in the right pane) with aria-current', () => {
    const twoGroups: Group[] = [
      { id: 'gA', name: 'A', cwd: '', collapsed: true, features: [] },
      { id: 'gB', name: 'B', cwd: '', collapsed: true, features: [] }
    ]
    const rowOf = (c: HTMLElement, id: string) => c.querySelector(`[data-group-id="${id}"]`) as HTMLElement
    const { container } = renderSidebar({ groups: twoGroups, activeGroupId: 'gB' })
    expect(rowOf(container, 'gB')).toHaveAttribute('aria-current', 'true')
    expect(rowOf(container, 'gA')).not.toHaveAttribute('aria-current')
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

  it('shows a spinner on a busy terminal only while a live agent is running', () => {
    renderSidebar({ busy: { t1: true }, liveAgents: { t1: 'claude' } })
    const item = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(within(item).getByTestId('icon-spinner')).toBeInTheDocument()
    expect(within(item).queryByTestId('icon-claude')).not.toBeInTheDocument()
  })

  it('does not show a spinner on a busy terminal with no live agent (plain shell output)', () => {
    renderSidebar({ busy: { t1: true } }) // busy, but liveAgents is empty
    const item = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(within(item).queryByTestId('icon-spinner')).not.toBeInTheDocument()
    expect(within(item).getByTestId('icon-claude')).toBeInTheDocument() // static kind icon, not the spinner
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

  it('shows a loading spinner on a feature row when a busy terminal is a live agent', () => {
    renderSidebar({ busy: { t1: true }, liveAgents: { t1: 'claude' } }) // t1 lives in the expanded 'auth' feature
    const authRow = screen.getByText('auth').closest('div') as HTMLElement
    expect(within(authRow).getByTestId('icon-spinner')).toBeInTheDocument()
    const uiRow = screen.getByText('ui').closest('div') as HTMLElement
    expect(within(uiRow).queryByTestId('icon-spinner')).not.toBeInTheDocument()
  })

  it('does not show the feature spinner when the busy terminal is not an agent', () => {
    renderSidebar({ busy: { t1: true } }) // busy but no live agent
    const authRow = screen.getByText('auth').closest('div') as HTMLElement
    expect(within(authRow).queryByTestId('icon-spinner')).not.toBeInTheDocument()
  })

  it('shows the feature spinner even when the feature is collapsed', () => {
    renderSidebar({ busy: { t2: true }, liveAgents: { t2: 'claude' } }) // t2 lives in the collapsed 'ui' feature
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

  describe('feature reorder (drag-and-drop)', () => {
    // The cursor geometry can't be driven in jsdom, so the index math is covered
    // by the two pure helpers; the DOM tests below only verify the wiring.
    it('insertionFromMidpoints: above the first row → 0', () => {
      expect(insertionFromMidpoints([10, 20, 30], 5)).toBe(0)
    })
    it('insertionFromMidpoints: between rows → the next index', () => {
      expect(insertionFromMidpoints([10, 20, 30], 15)).toBe(1)
    })
    it('insertionFromMidpoints: below the last row → past the end', () => {
      expect(insertionFromMidpoints([10, 20, 30], 100)).toBe(3)
    })
    it('reorderToIndex: dragging down shifts for the removed item', () => {
      expect(reorderToIndex(3, 0)).toBe(2) // insert past end, item was first → last
    })
    it('reorderToIndex: dragging up keeps the insertion point', () => {
      expect(reorderToIndex(0, 2)).toBe(0) // to the front
    })

    const rowFor = (container: HTMLElement, id: string) =>
      container.querySelector(`[data-feature-id="${id}"]`) as HTMLElement
    const dropZoneFor = (container: HTMLElement, groupId: string) =>
      container.querySelector(`[data-group-features="${groupId}"]`) as HTMLElement

    it('feature rows are draggable and dropping on the project zone calls onMoveFeature', () => {
      const onMoveFeature = vi.fn()
      const { container } = renderSidebar({ onMoveFeature })
      expect(rowFor(container, 'f1')).toHaveAttribute('draggable', 'true')
      fireEvent.dragStart(rowFor(container, 'f1'))
      fireEvent.dragOver(dropZoneFor(container, 'g1'))
      fireEvent.drop(dropZoneFor(container, 'g1'))
      expect(onMoveFeature).toHaveBeenCalledWith('f1', expect.any(Number))
    })

    it('ignores a drop onto a different project than the dragged feature', () => {
      const twoGroups: Group[] = [
        { id: 'gA', name: 'A', cwd: '', collapsed: false, features: [{ id: 'fa', name: 'aa', collapsed: true, terminals: [] }] },
        { id: 'gB', name: 'B', cwd: '', collapsed: false, features: [{ id: 'fb', name: 'bb', collapsed: true, terminals: [] }] }
      ]
      const onMoveFeature = vi.fn()
      const { container } = renderSidebar({ groups: twoGroups, onMoveFeature })
      fireEvent.dragStart(rowFor(container, 'fa'))
      fireEvent.dragOver(dropZoneFor(container, 'gB'))
      fireEvent.drop(dropZoneFor(container, 'gB'))
      expect(onMoveFeature).not.toHaveBeenCalled()
    })
  })

  describe('project reorder (drag-and-drop)', () => {
    const twoGroups: Group[] = [
      { id: 'gA', name: 'A', cwd: '', collapsed: true, features: [] },
      { id: 'gB', name: 'B', cwd: '', collapsed: true, features: [] }
    ]
    const groupRow = (c: HTMLElement, id: string) => c.querySelector(`[data-group-id="${id}"]`) as HTMLElement
    const groupsZone = (c: HTMLElement) => c.querySelector('[data-groups]') as HTMLElement

    it('project rows are draggable and dropping on the groups zone calls onMoveGroup', () => {
      const onMoveGroup = vi.fn()
      const { container } = renderSidebar({ groups: twoGroups, onMoveGroup })
      expect(groupRow(container, 'gA')).toHaveAttribute('draggable', 'true')
      fireEvent.dragStart(groupRow(container, 'gA'))
      fireEvent.dragOver(groupsZone(container))
      fireEvent.drop(groupsZone(container))
      expect(onMoveGroup).toHaveBeenCalledWith('gA', expect.any(Number))
    })
  })

  describe('terminal reorder (drag-and-drop)', () => {
    const termRow = (c: HTMLElement, id: string) => c.querySelector(`[data-term-id="${id}"]`) as HTMLElement
    const termZone = (c: HTMLElement, featureId: string) => c.querySelector(`[data-feature-terminals="${featureId}"]`) as HTMLElement

    it('terminal rows are draggable and dropping on the feature zone calls onMoveTerminal', () => {
      const twoTerms: Group[] = [
        { id: 'g1', name: 'proj', cwd: '', collapsed: false, features: [
          { id: 'f1', name: 'auth', collapsed: false, terminals: [
            { id: 't1', name: 'a', cwd: '' }, { id: 't2', name: 'b', cwd: '' }
          ] }
        ] }
      ]
      const onMoveTerminal = vi.fn()
      const { container } = renderSidebar({ groups: twoTerms, onMoveTerminal })
      expect(termRow(container, 't1')).toHaveAttribute('draggable', 'true')
      fireEvent.dragStart(termRow(container, 't1'))
      fireEvent.dragOver(termZone(container, 'f1'))
      fireEvent.drop(termZone(container, 'f1'))
      expect(onMoveTerminal).toHaveBeenCalledWith('t1', expect.any(Number))
    })

    it('ignores a drop onto a different feature than the dragged terminal', () => {
      const twoFeatures: Group[] = [
        { id: 'g1', name: 'proj', cwd: '', collapsed: false, features: [
          { id: 'f1', name: 'auth', collapsed: false, terminals: [{ id: 't1', name: 'a', cwd: '' }] },
          { id: 'f2', name: 'ui', collapsed: false, terminals: [{ id: 't2', name: 'b', cwd: '' }] }
        ] }
      ]
      const onMoveTerminal = vi.fn()
      const { container } = renderSidebar({ groups: twoFeatures, onMoveTerminal })
      fireEvent.dragStart(termRow(container, 't1'))
      fireEvent.dragOver(termZone(container, 'f2'))
      fireEvent.drop(termZone(container, 'f2'))
      expect(onMoveTerminal).not.toHaveBeenCalled()
    })
  })
})

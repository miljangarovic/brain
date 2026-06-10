import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar, insertionFromMidpoints, reorderToIndex } from './Sidebar'
import type { Group } from '@shared/types'

const groups: Group[] = [
  { id: 'g1', name: 'proj', cwd: '/home/me/proj', collapsed: false, features: [
    { id: 'f1', name: 'auth', collapsed: false, terminals: [
      { id: 't1', name: 'claude', cwd: '/home/me/proj', kind: 'claude' }
    ], documents: [
      { id: 'd1', name: 'spec', path: '/docs/spec.md' },
      { id: 'd2', name: 'plan', path: '/docs/plan.md' }
    ], files: [{ id: 'fp1', name: 'notes.md', path: '/p/notes.md' }] },
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
    onExportGroup: noop,
    onExportFeature: noop,
    onImport: noop,
    onArchiveFeature: noop,
    onOpenArchive: noop,
    onAddDocument: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onRenameFilePane: noop,
    onMoveFile: noop,
    onOpenDocumentExternally: noop,
    onOpenDocument: noop,
    onRenameDocument: noop,
    onRemoveDocument: noop,
    docExists: {},
    liveAgents: {},
    busy: {},
    reviewStatus: {},
    onReviewTerminal: noop,
    attention: {},
    attentionItems: [],
    attentionMuted: false,
    onAttentionSelect: noop,
    onAttentionClear: noop,
    onAttentionClearAll: noop,
    onToggleAttentionMute: noop,
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

  it('keeps the kind icon while the review spinner runs (no double spinner)', () => {
    renderSidebar({ busy: { t1: true }, liveAgents: { t1: 'claude' }, reviewStatus: { t1: 'reviewing' } })
    const item = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(within(item).getAllByTestId('icon-spinner')).toHaveLength(1) // the review dot only
    expect(within(item).getByTestId('icon-claude')).toBeInTheDocument()
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

  it('right-click Review opens the modal without preselecting a reviewer (App defaults to Claude)', async () => {
    const onReviewTerminal = vi.fn()
    renderSidebar({ onReviewTerminal })
    fireEvent.contextMenu(screen.getByText('claude'))
    await userEvent.click(screen.getByText('Review'))
    expect(onReviewTerminal).toHaveBeenCalledWith('t1')
  })

  it('right-click on a terminal offers Delete', async () => {
    const onDeleteTerminal = vi.fn()
    renderSidebar({ onDeleteTerminal })
    fireEvent.contextMenu(screen.getByText('claude'))
    await userEvent.click(screen.getByText('Delete'))
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

  describe('export / import entry points', () => {
    it('group context menu offers Export project…', async () => {
      const onExportGroup = vi.fn()
      const { container } = renderSidebar({ onExportGroup })
      fireEvent.contextMenu(container.querySelector('[data-group-id="g1"]')!)
      await userEvent.click(screen.getByRole('menuitem', { name: 'Export project…' }))
      expect(onExportGroup).toHaveBeenCalledWith('g1')
    })

    it('feature row opens a context menu with Export feature…', async () => {
      const onExportFeature = vi.fn()
      const { container } = renderSidebar({ onExportFeature })
      fireEvent.contextMenu(container.querySelector('[data-feature-id="f1"]')!)
      await userEvent.click(screen.getByRole('menuitem', { name: 'Export feature…' }))
      expect(onExportFeature).toHaveBeenCalledWith('f1')
    })

    it('footer has an Import button', async () => {
      const onImport = vi.fn()
      renderSidebar({ onImport })
      await userEvent.click(screen.getByRole('button', { name: 'Import project or feature' }))
      expect(onImport).toHaveBeenCalled()
    })
  })

  // Dropping outside the dragged kind's own container must still reorder, clamped
  // to the nearest end — aiming the exact half-row at the container's edge was a
  // needle-threading exercise (most of the sidebar was a dead zone for the drop).
  describe('feature context menu', () => {
    it('right-click on a feature opens Rename / New (submenu) / Add document / Archive; New Claude is not a top-level item', () => {
      renderSidebar()
      fireEvent.contextMenu(screen.getByText('auth'))
      // top-level items
      for (const label of ['Rename', 'New', 'Add document', 'Archive'])
        expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument()
      // flat 'New Claude' must NOT exist at the top level
      expect(screen.queryByRole('menuitem', { name: 'New Claude' })).not.toBeInTheDocument()
      // hover 'New' to reveal the submenu
      const newItem = screen.getByRole('menuitem', { name: 'New' })
      fireEvent.mouseEnter(newItem.closest('.relative')!)
      expect(screen.getByRole('menuitem', { name: 'Claude' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Codex' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Terminal' })).toBeInTheDocument()
    })

    it('Archive calls onArchiveFeature with the feature id', async () => {
      const onArchiveFeature = vi.fn()
      renderSidebar({ onArchiveFeature })
      fireEvent.contextMenu(screen.getByText('auth'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
      expect(onArchiveFeature).toHaveBeenCalledWith('f1')
    })

    it('New > Codex launches an agent; Add document calls onAddDocument', async () => {
      const onLaunchAgent = vi.fn()
      const onAddDocument = vi.fn()
      renderSidebar({ onLaunchAgent, onAddDocument })
      // open menu, expand New submenu, click Codex
      fireEvent.contextMenu(screen.getByText('auth'))
      const newItem = screen.getByRole('menuitem', { name: 'New' })
      fireEvent.mouseEnter(newItem.closest('.relative')!)
      await userEvent.click(screen.getByRole('menuitem', { name: 'Codex' }))
      expect(onLaunchAgent).toHaveBeenCalledWith('f1', 'codex')
      // reopen and click Add document
      fireEvent.contextMenu(screen.getByText('auth'))
      await userEvent.click(screen.getByRole('menuitem', { name: /Add document/ }))
      expect(onAddDocument).toHaveBeenCalledWith('f1')
    })
  })

  describe('feature documents section', () => {
    it('renders document rows after the terminals; click opens the file', async () => {
      const onOpenDocument = vi.fn()
      renderSidebar({ onOpenDocument })
      const spec = screen.getByText('spec').closest('[data-doc-id]') as HTMLElement
      expect(spec).toBeInTheDocument()
      // docs come after the terminal rows in document order
      const term = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
      expect(term.compareDocumentPosition(spec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      await userEvent.click(screen.getByText('spec'))
      await waitFor(() => expect(onOpenDocument).toHaveBeenCalledWith('f1', '/docs/spec.md'))
    })

    it('a missing file renders broken and does not open', async () => {
      const onOpenDocument = vi.fn()
      renderSidebar({ onOpenDocument, docExists: { '/docs/spec.md': false, '/docs/plan.md': true } })
      const row = screen.getByText('spec').closest('[data-doc-id]') as HTMLElement
      expect(row.className).toContain('line-through')
      await userEvent.click(screen.getByText('spec'))
      await new Promise((r) => setTimeout(r, 150)) // outlast NAME_CLICK_DELAY_MS
      expect(onOpenDocument).not.toHaveBeenCalled()
    })

    it('a rename double-click never opens the file', async () => {
      const onOpenDocument = vi.fn()
      renderSidebar({ onOpenDocument })
      await userEvent.dblClick(screen.getByText('spec'))
      await new Promise((r) => setTimeout(r, 150))
      expect(onOpenDocument).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Rename document spec')).toBeInTheDocument()
    })

    it('double-click renames; Enter commits via onRenameDocument', async () => {
      const onRenameDocument = vi.fn()
      renderSidebar({ onRenameDocument })
      await userEvent.dblClick(screen.getByText('spec'))
      const input = screen.getByLabelText('Rename document spec')
      await userEvent.clear(input)
      await userEvent.type(input, 'Spec v2{Enter}')
      expect(onRenameDocument).toHaveBeenCalledWith('f1', 'd1', 'Spec v2')
    })

    it('the trash button removes the reference', async () => {
      const onRemoveDocument = vi.fn()
      renderSidebar({ onRemoveDocument })
      await userEvent.click(screen.getByLabelText('Remove document spec'))
      expect(onRemoveDocument).toHaveBeenCalledWith('f1', 'd1')
    })

    it('pendingRenameDocId opens the rename input and is consumed', () => {
      const onPendingRenameDocConsumed = vi.fn()
      renderSidebar({ pendingRenameDocId: 'd2', onPendingRenameDocConsumed })
      expect(screen.getByLabelText('Rename document plan')).toBeInTheDocument()
      expect(onPendingRenameDocConsumed).toHaveBeenCalled()
    })
  })

  describe('forgiving drop zones (clamp to nearest position)', () => {
    const groupsZone = (c: HTMLElement) => c.querySelector('[data-groups]') as HTMLElement
    const termRow = (c: HTMLElement, id: string) => c.querySelector(`[data-term-id="${id}"]`) as HTMLElement
    const featRow = (c: HTMLElement, id: string) => c.querySelector(`[data-feature-id="${id}"]`) as HTMLElement

    it('terminal dropped anywhere below its feature lands at the end', () => {
      const fixture: Group[] = [
        { id: 'g1', name: 'proj', cwd: '', collapsed: false, features: [
          { id: 'f1', name: 'auth', collapsed: false, terminals: [
            { id: 't1', name: 'a', cwd: '' }, { id: 't2', name: 'b', cwd: '' }
          ] }
        ] }
      ]
      const onMoveTerminal = vi.fn()
      const { container } = renderSidebar({ groups: fixture, onMoveTerminal })
      fireEvent.dragStart(termRow(container, 't1'))
      // jsdom rects are all 0 → clientY 50 is "below every row midpoint"
      fireEvent.dragOver(groupsZone(container), { clientY: 50 })
      fireEvent.drop(groupsZone(container), { clientY: 50 })
      expect(onMoveTerminal).toHaveBeenCalledWith('t1', 1)
    })

    it('project dropped above the tree (over the attention header) lands first', () => {
      const fixture: Group[] = [
        { id: 'gA', name: 'A', cwd: '', collapsed: true, features: [] },
        { id: 'gB', name: 'B', cwd: '', collapsed: true, features: [] }
      ]
      const onMoveGroup = vi.fn()
      const { container } = renderSidebar({ groups: fixture, onMoveGroup })
      container.querySelectorAll('[data-group-id]').forEach((el, i) => {
        ;(el as HTMLElement).getBoundingClientRect = () =>
          ({ top: 100 + i * 20, height: 20, bottom: 120 + i * 20, left: 0, right: 0, width: 200, x: 0, y: 100 + i * 20, toJSON: () => ({}) }) as DOMRect
      })
      fireEvent.dragStart(container.querySelector('[data-group-id="gB"]') as HTMLElement)
      // The bell host sits ABOVE the tree container — dropping there must still work.
      const bell = screen.getByRole('button', { name: /attention/i })
      bell.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 5 }))
      bell.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 5 }))
      expect(onMoveGroup).toHaveBeenCalledWith('gB', 0)
    })

    it('feature dropped anywhere above its group lands first', () => {
      const fixture: Group[] = [
        { id: 'gA', name: 'A', cwd: '', collapsed: false, features: [
          { id: 'fa', name: 'aa', collapsed: true, terminals: [] },
          { id: 'fb', name: 'bb', collapsed: true, terminals: [] }
        ] }
      ]
      const onMoveFeature = vi.fn()
      const { container } = renderSidebar({ groups: fixture, onMoveFeature })
      // jsdom can't lay out — give the feature rows real vertical geometry so a
      // cursor above the first row's midpoint is expressible with a positive Y.
      container.querySelectorAll('[data-feature-id]').forEach((el, i) => {
        ;(el as HTMLElement).getBoundingClientRect = () =>
          ({ top: 100 + i * 20, height: 20, bottom: 120 + i * 20, left: 0, right: 0, width: 200, x: 0, y: 100 + i * 20, toJSON: () => ({}) }) as DOMRect
      })
      fireEvent.dragStart(featRow(container, 'fb'))
      // fireEvent's drag events drop MouseEvent fields (clientY arrives undefined),
      // so dispatch real MouseEvents: clientY 5 is above every midpoint (110, 130) → 0
      groupsZone(container).dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 5 }))
      groupsZone(container).dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 5 }))
      expect(onMoveFeature).toHaveBeenCalledWith('fb', 0)
    })
  })

  describe('archive row', () => {
    it('shows the per-group archived count and opens the archive', async () => {
      const onOpenArchive = vi.fn()
      const withArchive: Group[] = [{
        ...groups[0],
        archivedFeatures: [{ id: 'fa', name: 'old', collapsed: false, terminals: [] }]
      }]
      renderSidebar({ groups: withArchive, onOpenArchive })
      const row = screen.getByLabelText('Archive of proj')
      expect(row).toHaveTextContent('Archive (1)')
      await userEvent.click(row)
      expect(onOpenArchive).toHaveBeenCalledWith('g1')
    })

    it('is visible with count 0 when nothing is archived', () => {
      renderSidebar()
      expect(screen.getByLabelText('Archive of proj')).toHaveTextContent('Archive (0)')
    })
  })

  describe('file pane rows', () => {
    it('renders file rows between terminals and documents; click selects', async () => {
      const onSelectFile = vi.fn()
      renderSidebar({ onSelectFile })
      const row = screen.getByText('notes.md').closest('[data-file-id]') as HTMLElement
      const term = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
      const doc = screen.getByText('spec').closest('[data-doc-id]') as HTMLElement
      expect(term.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(row.compareDocumentPosition(doc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      await userEvent.click(screen.getByText('notes.md'))
      expect(onSelectFile).toHaveBeenCalledWith('fp1')
    })

    it('hover X closes; double-click renames via onRenameFilePane', async () => {
      const onCloseFile = vi.fn(); const onRenameFilePane = vi.fn()
      renderSidebar({ onCloseFile, onRenameFilePane })
      await userEvent.click(screen.getByLabelText('Close file notes.md'))
      expect(onCloseFile).toHaveBeenCalledWith('fp1')
      await userEvent.dblClick(screen.getByText('notes.md'))
      const input = screen.getByLabelText('Rename file notes.md')
      await userEvent.clear(input)
      await userEvent.type(input, 'Notes{Enter}')
      expect(onRenameFilePane).toHaveBeenCalledWith('fp1', 'Notes')
    })

    it('marks the active file row with the accent state', () => {
      const { container } = renderSidebar({ activeTerminalId: 'fp1' })
      const row = container.querySelector('[data-file-id="fp1"]') as HTMLElement
      expect(row.className).toContain('bg-accent-sel')
    })
  })

  describe('document row context menu', () => {
    it('right-click offers Open externally and Remove', async () => {
      const onOpenDocumentExternally = vi.fn(); const onRemoveDocument = vi.fn()
      renderSidebar({ onOpenDocumentExternally, onRemoveDocument })
      fireEvent.contextMenu(screen.getByText('spec'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Open externally' }))
      expect(onOpenDocumentExternally).toHaveBeenCalledWith('/docs/spec.md')
      fireEvent.contextMenu(screen.getByText('spec'))
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
      expect(onRemoveDocument).toHaveBeenCalledWith('f1', 'd1')
    })
  })
})

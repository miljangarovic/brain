// src/renderer/src/components/TabBar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'
import type { Terminal } from '@shared/types'
import type { TabItem } from './TabBar'

const termA: Terminal = { id: 'tA', name: 'shellA', cwd: '' }
const termB: Terminal = { id: 'tB', name: 'shellB', cwd: '' }

const t = (term: Terminal): TabItem => ({ kind: 'terminal', terminal: term })

const terms: Terminal[] = [
  { id: 'a', name: 'claude-api', cwd: '' },
  { id: 'b', name: 'tests', cwd: '' }
]
function noop() {}

// Defaults for the review props; spread into each render so
// existing assertions stay focused on the behavior under test.
const reviewProps = {
  reviewStatus: {},
  busy: {},
  attention: {},
}

function renderTabBar(overrides: Partial<Parameters<typeof TabBar>[0]> = {}) {
  const defaults: Parameters<typeof TabBar>[0] = {
    items: [t(termA)],
    activeId: null,
    liveAgents: {},
    onSelect: noop,
    onClose: noop,
    onOpenExternally: noop,
    ...reviewProps,
  }
  return render(<TabBar {...defaults} {...overrides} />)
}

describe('TabBar', () => {
  it('renders a tab per terminal and marks the active one', () => {
    renderTabBar({ items: [t(terms[0]), t(terms[1])], activeId: 'a' })
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.getByText('tests')).toBeInTheDocument()
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('claude-api')
  })

  it('calls onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn()
    renderTabBar({ items: [t(terms[0]), t(terms[1])], activeId: 'a', onSelect })
    await userEvent.click(screen.getByText('tests'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('calls onClose without selecting when the × is clicked', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    renderTabBar({ items: [t(terms[0]), t(terms[1])], activeId: 'a', onSelect, onClose })
    await userEvent.click(screen.getByLabelText('Close tests'))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows the kind icon on an agent tab', () => {
    const agentTerms: Terminal[] = [{ id: 'a', name: 'claude', cwd: '', kind: 'claude' }]
    renderTabBar({ items: [t(agentTerms[0])], activeId: 'a' })
    const tab = screen.getByRole('tab')
    expect(within(tab).getByTestId('icon-claude')).toBeInTheDocument()
  })

  it('shows a spinner on a busy tab only while a live agent is running', () => {
    renderTabBar({ items: [t(terms[0]), t(terms[1])], activeId: 'a', liveAgents: { a: 'claude' }, busy: { a: true } })
    const tab = screen.getAllByRole('tab')[0]
    expect(within(tab).getByTestId('icon-spinner')).toBeInTheDocument()
  })

  it('keeps the kind icon while the review spinner runs (no double spinner)', () => {
    renderTabBar({
      items: [t(terms[0]), t(terms[1])],
      activeId: 'a',
      liveAgents: { a: 'claude' },
      busy: { a: true },
      reviewStatus: { a: 'reviewing' }
    })
    const tab = screen.getAllByRole('tab')[0]
    expect(within(tab).getAllByTestId('icon-spinner')).toHaveLength(1) // the review dot only
    expect(within(tab).getByTestId('icon-claude')).toBeInTheDocument()
  })

  it('does not show a spinner on a busy tab with no live agent (plain shell output)', () => {
    renderTabBar({ items: [t(terms[0]), t(terms[1])], activeId: 'a', busy: { a: true } })
    const tab = screen.getAllByRole('tab')[0]
    expect(within(tab).queryByTestId('icon-spinner')).not.toBeInTheDocument()
  })

  it('right-clicks a tab and closes all tabs to the right of it', async () => {
    const terms3: Terminal[] = [
      { id: 'a', name: 'one', cwd: '' },
      { id: 'b', name: 'two', cwd: '' },
      { id: 'c', name: 'three', cwd: '' }
    ]
    const onClose = vi.fn()
    renderTabBar({ items: [t(terms3[0]), t(terms3[1]), t(terms3[2])], activeId: 'b', onClose })
    fireEvent.contextMenu(screen.getByText('two'))
    expect(screen.getByRole('menuitem', { name: 'Close other tabs' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Close tabs to the left' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('c')
  })

  it('omits the left/right close options that do not apply at an edge tab', () => {
    const terms3: Terminal[] = [
      { id: 'a', name: 'one', cwd: '' },
      { id: 'b', name: 'two', cwd: '' },
      { id: 'c', name: 'three', cwd: '' }
    ]
    renderTabBar({ items: [t(terms3[0]), t(terms3[1]), t(terms3[2])], activeId: 'a' })
    fireEvent.contextMenu(screen.getByText('one'))
    expect(screen.queryByRole('menuitem', { name: 'Close tabs to the left' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Close tabs to the right' })).toBeInTheDocument()
  })

  it('a live agent overrides the tab icon', () => {
    const term = [{ id: 'a', name: 'work', cwd: '' }]
    renderTabBar({ items: [t(term[0])], activeId: 'a', liveAgents: { a: 'claude' } })
    const tab = screen.getByRole('tab')
    expect(within(tab).getByTestId('icon-claude')).toBeInTheDocument()
  })
})

describe('file tabs', () => {
  const fileItem: TabItem = { kind: 'file', pane: { id: 'p1', path: '/p/readme.md', name: 'readme.md' } }

  it('renders a file tab with the file icon and closes via X', async () => {
    const onClose = vi.fn()
    renderTabBar({ items: [t(termA), fileItem], onClose })
    const tab = screen.getByText('readme.md').closest('[role="tab"]') as HTMLElement
    expect(within(tab).getByTestId('icon-file-code')).toBeInTheDocument()
    await userEvent.click(within(tab).getByLabelText('Close readme.md'))
    expect(onClose).toHaveBeenCalledWith('p1')
  })

  it('file tab context menu offers Open externally and Close — no bulk items', async () => {
    const onOpenExternally = vi.fn(); const onClose = vi.fn()
    renderTabBar({ items: [t(termA), fileItem], onOpenExternally, onClose })
    fireEvent.contextMenu(screen.getByText('readme.md'))
    expect(screen.queryByRole('menuitem', { name: /Close other tabs/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open externally' }))
    expect(onOpenExternally).toHaveBeenCalledWith('/p/readme.md')
    fireEvent.contextMenu(screen.getByText('readme.md'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledWith('p1')
  })

  it('terminal-tab bulk close sweeps file tabs too (onClose per id; App dispatches per kind)', async () => {
    const onClose = vi.fn()
    renderTabBar({ items: [t(termA), fileItem, t(termB)], onClose })
    fireEvent.contextMenu(screen.getByText(termA.name))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }))
    expect(onClose).toHaveBeenCalledWith('p1')
    expect(onClose).toHaveBeenCalledWith(termB.id)
  })
})

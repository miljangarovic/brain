import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Terminal } from '@shared/types'

// Stub the live terminal so the pane chrome can be tested without xterm/PTY.
vi.mock('./TerminalView', () => ({ TerminalView: () => <div data-testid="terminal-view" /> }))

import { TerminalPane } from './TerminalPane'

const terminal: Terminal = { id: 't1', name: 'api', cwd: '/x', kind: 'claude' }
const base = {
  terminal,
  active: false,
  gridded: false,
  visibleInTabs: false,
  busy: false,
  liveAgent: undefined as 'claude' | 'codex' | undefined,
  reviewStatus: undefined,
  onActivate: () => {},
  started: true,
  onStart: () => {},
}

beforeEach(() => vi.clearAllMocks())

describe('TerminalPane', () => {
  it('renders a header with the name and kind icon when gridded', () => {
    render(<TerminalPane {...base} gridded />)
    expect(screen.getByText('api')).toBeInTheDocument()
    expect(screen.getByTestId('icon-claude')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
  })

  it('shows a spinner in the header instead of the kind icon while busy', () => {
    render(<TerminalPane {...base} gridded busy />)
    expect(screen.getByTestId('icon-spinner')).toBeInTheDocument()
    expect(screen.queryByTestId('icon-claude')).not.toBeInTheDocument()
  })

  it('keeps the kind icon while the review spinner runs (no double spinner)', () => {
    render(<TerminalPane {...base} gridded busy reviewStatus="reviewing" />)
    expect(screen.getAllByTestId('icon-spinner')).toHaveLength(1) // the review dot only
    expect(screen.getByTestId('icon-claude')).toBeInTheDocument()
  })

  it('activates on mousedown when gridded', () => {
    const onActivate = vi.fn()
    render(<TerminalPane {...base} gridded onActivate={onActivate} />)
    fireEvent.mouseDown(screen.getByText('api'))
    expect(onActivate).toHaveBeenCalled()
  })

  it('renders no header in tabs mode — just the terminal', () => {
    render(<TerminalPane {...base} gridded={false} visibleInTabs />)
    expect(screen.queryByText('api')).not.toBeInTheDocument()
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
  })

  it('makes the header a drag handle and reorders via drag/drop when dnd is set', () => {
    const dnd = {
      dragging: false,
      isDropTarget: false,
      onHandleDragStart: vi.fn(),
      onDragEnd: vi.fn(),
      onDragOver: vi.fn(),
      onDrop: vi.fn(),
    }
    const { container } = render(<TerminalPane {...base} gridded dnd={dnd} />)

    // Only the header is the drag handle — the body stays selectable.
    const handle = container.querySelector('[draggable="true"]')!
    expect(handle).toBe(screen.getByText('api').parentElement)

    fireEvent.dragStart(handle)
    expect(dnd.onHandleDragStart).toHaveBeenCalled()

    // The whole pane is the drop zone.
    fireEvent.dragOver(screen.getByTestId('terminal-view'))
    fireEvent.drop(screen.getByTestId('terminal-view'))
    expect(dnd.onDragOver).toHaveBeenCalled()
    expect(dnd.onDrop).toHaveBeenCalled()
  })

  it('is not draggable when no dnd is provided', () => {
    const { container } = render(<TerminalPane {...base} gridded />)
    expect(container.querySelector('[draggable="true"]')).toBeNull()
  })

  it('shows a cold placeholder instead of the terminal until started', () => {
    render(<TerminalPane {...base} visibleInTabs started={false} />)
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
    expect(screen.getByText(/click to start/i)).toBeInTheDocument()
  })

  it('clicking the placeholder starts the terminal', () => {
    const onStart = vi.fn()
    render(<TerminalPane {...base} visibleInTabs started={false} onStart={onStart} />)
    fireEvent.click(screen.getByText(/click to start/i))
    expect(onStart).toHaveBeenCalled()
  })

  it('keeps the pane header in grid mode while cold', () => {
    render(<TerminalPane {...base} gridded started={false} />)
    expect(screen.getByText('api')).toBeInTheDocument()           // header chrome stays
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('mounts the live terminal once started', () => {
    render(<TerminalPane {...base} visibleInTabs started />)
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    expect(screen.queryByText(/click to start/i)).not.toBeInTheDocument()
  })

  it('spans rows or columns per the grid style', () => {
    const { container, rerender } = render(<TerminalPane {...base} gridded gridRowSpan={2} />)
    expect((container.firstChild as HTMLElement).style.gridRow).toBe('span 2')
    rerender(<TerminalPane {...base} gridded gridColSpan={3} />)
    expect((container.firstChild as HTMLElement).style.gridColumn).toBe('span 3')
  })
})

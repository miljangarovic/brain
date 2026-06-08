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
})

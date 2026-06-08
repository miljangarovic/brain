// src/renderer/src/components/TerminalView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { Terminal as TerminalModel } from '@shared/types'

// xterm needs a real canvas/DOM and ResizeObserver, neither of which jsdom
// provides — stub them so we can exercise the component's PTY lifecycle wiring.
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80
    rows = 24
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    onData(): { dispose(): void } { return { dispose() {} } }
    attachCustomKeyEventHandler(): void {}
    getSelection(): string { return '' }
    paste(): void {}
    selectAll(): void {}
    focus(): void {}
    dispose(): void {}
  }
  return { Terminal }
})
vi.mock('@xterm/addon-fit', () => {
  class FitAddon { fit(): void {} }
  return { FitAddon }
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub

const api = {
  createPty: vi.fn(),
  killPty: vi.fn(),
  writePty: vi.fn(),
  resizePty: vi.fn(),
  onPtyData: vi.fn(() => vi.fn()),
  onPtyExit: vi.fn(() => vi.fn()),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { terminaltor: typeof api }).terminaltor = api
})

// Import after the mocks above are registered.
import { TerminalView } from './TerminalView'

const term: TerminalModel = { id: 't1', name: 'claude', cwd: '/x', startupCommand: 'claude', kind: 'claude' }

describe('TerminalView PTY lifecycle', () => {
  it('creates the PTY on mount', () => {
    render(<TerminalView terminal={term} active />)
    expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', startupCommand: 'claude' }))
  })

  it('does NOT kill the PTY when the view unmounts (HMR/Fast Refresh remount must keep the shell alive)', () => {
    const { unmount } = render(<TerminalView terminal={term} active />)
    unmount()
    expect(api.killPty).not.toHaveBeenCalled()
  })
})

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
    buffer = {
      active: {
        getLine: (_i: number) => ({
          translateToString: () => (globalThis as unknown as { __termLine?: string }).__termLine ?? ''
        })
      }
    }
    loadAddon(): void {}
    open(): void {}
    write(): void {}
    onData(): { dispose(): void } { return { dispose() {} } }
    attachCustomKeyEventHandler(): void {}
    registerLinkProvider(p: unknown): { dispose(): void } {
      ;(globalThis as unknown as { __linkProvider?: unknown }).__linkProvider = p
      return { dispose() {} }
    }
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
  openPath: vi.fn(),
  resolvePathLinks: vi.fn(async (): Promise<(string | null)[]> => []),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { brain: typeof api }).brain = api
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

  it('spawns a restored claude terminal with its resume command', () => {
    render(<TerminalView terminal={term} active resume />)
    expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', startupCommand: 'claude --continue' }))
  })

  it('spawns a restored codex terminal with its resume command', () => {
    const codex: TerminalModel = { id: 't2', name: 'codex', cwd: '/x', startupCommand: 'codex', kind: 'codex' }
    render(<TerminalView terminal={codex} active resume />)
    expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({ id: 't2', startupCommand: 'codex resume --last' }))
  })

  it('a restored plain shell keeps its saved startup command (no resume form)', () => {
    const shell: TerminalModel = { id: 't3', name: 'dev', cwd: '/x', startupCommand: 'npm run dev', kind: 'shell' }
    render(<TerminalView terminal={shell} active resume />)
    expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({ id: 't3', startupCommand: 'npm run dev' }))
  })

  it('a fresh agent terminal keeps its saved startup command verbatim (reviewer prompt must survive)', () => {
    // Reviewer terminals persist `claude --session-id X '<review prompt>'` —
    // the fresh mount must not replace it with a bare agent command.
    const reviewer: TerminalModel = {
      id: 't4', name: 'review: claude', cwd: '/x', kind: 'claude', sessionId: 'sess-4',
      startupCommand: "claude --session-id sess-4 'Review the diff and write a verdict'"
    }
    render(<TerminalView terminal={reviewer} active />)
    expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({
      id: 't4', startupCommand: "claude --session-id sess-4 'Review the diff and write a verdict'"
    }))
  })

  it('resumes a restored claude terminal by its exact session id', () => {
    const claude: TerminalModel = { id: 't4', name: 'claude', cwd: '/x', startupCommand: 'claude', kind: 'claude', sessionId: 'sess-4' }
    render(<TerminalView terminal={claude} active resume />)
    expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({ id: 't4', startupCommand: 'claude --resume sess-4' }))
  })

  it('resumes a restored codex terminal by its detected session id', () => {
    const codex: TerminalModel = { id: 't5', name: 'codex', cwd: '/x', startupCommand: 'codex', kind: 'codex', sessionId: 'sess-5' }
    render(<TerminalView terminal={codex} active resume />)
    expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({ id: 't5', startupCommand: 'codex resume sess-5' }))
  })
})

describe('TerminalView file links', () => {
  type Link = {
    range: { start: { x: number; y: number }; end: { x: number; y: number } }
    text: string
    activate: (e: MouseEvent, text: string) => void
  }
  type Provider = { provideLinks: (y: number, cb: (links: Link[] | undefined) => void) => void }
  const provider = () => (globalThis as unknown as { __linkProvider?: Provider }).__linkProvider!
  const setLine = (s: string) => { (globalThis as unknown as { __termLine?: string }).__termLine = s }

  it('underlines only paths that exist and opens them on Ctrl+click', async () => {
    setLine('vidi src/a.ts:12 i src/missing.ts')
    api.resolvePathLinks.mockResolvedValue(['/x/src/a.ts', null])
    render(<TerminalView terminal={term} active />)
    const links = await new Promise<Link[] | undefined>((r) => provider().provideLinks(1, r))
    expect(api.resolvePathLinks).toHaveBeenCalledWith({ cwd: '/x', candidates: ['src/a.ts', 'src/missing.ts'] })
    expect(links).toHaveLength(1)
    // 'vidi ' is 5 chars → 1-based start x=6; 'src/a.ts:12' is 11 chars → inclusive end x=16.
    expect(links![0].range).toEqual({ start: { x: 6, y: 1 }, end: { x: 16, y: 1 } })

    links![0].activate({ ctrlKey: false, metaKey: false } as MouseEvent, links![0].text)
    expect(api.openPath).not.toHaveBeenCalled() // plain click belongs to the TUI
    links![0].activate({ ctrlKey: true, metaKey: false } as MouseEvent, links![0].text)
    expect(api.openPath).toHaveBeenCalledWith('/x/src/a.ts')
  })

  it('offers no links for a line without existing paths', async () => {
    setLine('obican tekst bez putanja')
    render(<TerminalView terminal={term} active />)
    const links = await new Promise<Link[] | undefined>((r) => provider().provideLinks(1, r))
    expect(links).toBeUndefined()
    expect(api.resolvePathLinks).not.toHaveBeenCalled()
  })
})

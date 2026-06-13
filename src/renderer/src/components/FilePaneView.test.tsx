import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePaneView, SAVE_DEBOUNCE_MS } from './FilePaneView'
import type { FilePane } from '@shared/types'
import type { FileLoadResult } from '@shared/files'

// CodeMirror needs layout APIs jsdom lacks — substitute a plain textarea that
// forwards value/onChange; FilePaneView's logic is what we're testing.
vi.mock('./CodeEditor', () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange: (t: string) => void }) => (
    <textarea aria-label="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  )
}))

const pane: FilePane = { id: 'p1', path: '/p/readme.md', name: 'readme.md' }

type BrainMock = {
  loadFile: ReturnType<typeof vi.fn>
  saveFile: ReturnType<typeof vi.fn>
  watchFile: ReturnType<typeof vi.fn>
  unwatchFile: ReturnType<typeof vi.fn>
  onFsChanged: ReturnType<typeof vi.fn>
  openPath: ReturnType<typeof vi.fn>
}
let brain: BrainMock
let fsChangedCb: ((watchId: string) => void) | null

const setBrain = (load: FileLoadResult) => {
  fsChangedCb = null
  brain = {
    loadFile: vi.fn().mockResolvedValue(load),
    saveFile: vi.fn().mockResolvedValue({ ok: true }),
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
    onFsChanged: vi.fn((cb: (id: string) => void) => { fsChangedCb = cb; return () => { fsChangedCb = null } }),
    openPath: vi.fn()
  }
  ;(window as unknown as { brain: BrainMock }).brain = brain
}

function renderPane(over: Partial<Parameters<typeof FilePaneView>[0]> = {}) {
  const props = {
    pane, active: true, gridded: false, visibleInTabs: true,
    onActivate: () => {}, onClose: () => {}, onSetMdView: () => {}, onOpenExternally: () => {},
    ...over
  }
  return render(<FilePaneView {...props} />)
}

afterEach(() => vi.useRealTimers())

describe('FilePaneView', () => {
  it('loads text and shows the editor (md defaults to rendered view)', async () => {
    setBrain({ kind: 'text', content: '# hi' })
    renderPane()
    // .md + default mdView 'rendered' → MarkdownView, not the editor
    expect(await screen.findByRole('heading', { name: 'hi' })).toBeInTheDocument()
    expect(brain.watchFile).toHaveBeenCalledWith('p1', '/p/readme.md')
  })

  it('raw mdView shows the editor; the toggle calls onSetMdView', async () => {
    setBrain({ kind: 'text', content: '# hi' })
    const onSetMdView = vi.fn()
    renderPane({ pane: { ...pane, mdView: 'raw' }, onSetMdView })
    expect(await screen.findByLabelText('editor')).toHaveValue('# hi')
    await userEvent.click(screen.getByRole('button', { name: 'Rendered view' }))
    expect(onSetMdView).toHaveBeenCalledWith('rendered')
  })

  it('non-md text goes straight to the editor', async () => {
    setBrain({ kind: 'text', content: 'const x = 1' })
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    expect(await screen.findByLabelText('editor')).toHaveValue('const x = 1')
  })

  it('debounces auto-save and writes the latest content', async () => {
    setBrain({ kind: 'text', content: 'a' })
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    const editor = await screen.findByLabelText('editor')
    vi.useFakeTimers()
    // fire two rapid changes through the textarea's onChange
    act(() => {
      const ev = (v: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        setter.call(editor, v)
        editor.dispatchEvent(new Event('input', { bubbles: true }))
      }
      ev('ab'); ev('abc')
    })
    expect(brain.saveFile).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10) })
    expect(brain.saveFile).toHaveBeenCalledTimes(1)
    expect(brain.saveFile).toHaveBeenCalledWith('/p/a.ts', 'abc')
  })

  it('FLUSHES the pending save on unmount', async () => {
    setBrain({ kind: 'text', content: 'a' })
    const r = renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    const editor = await screen.findByLabelText('editor')
    vi.useFakeTimers()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(editor, 'ab')
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    r.unmount() // inside the debounce window
    expect(brain.saveFile).toHaveBeenCalledWith('/p/a.ts', 'ab')
    expect(brain.unwatchFile).toHaveBeenCalledWith('p2')
  })

  it('external change with a clean editor reloads silently; self-echo is ignored', async () => {
    setBrain({ kind: 'text', content: 'v1' })
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    await screen.findByLabelText('editor')
    brain.loadFile.mockResolvedValue({ kind: 'text', content: 'v2' })
    await act(async () => { fsChangedCb?.('p2') })
    await waitFor(() => expect(screen.getByLabelText('editor')).toHaveValue('v2'))
    // self-echo: disk equals what we already have → no visible change, no error
    await act(async () => { fsChangedCb?.('p2') })
    expect(screen.getByLabelText('editor')).toHaveValue('v2')
  })

  it('renders the framed header in tabs mode too (name + close button)', async () => {
    setBrain({ kind: 'text', content: 'x' })
    const onClose = vi.fn()
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' }, onClose })
    await screen.findByLabelText('editor')
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Close a.ts'))
    expect(onClose).toHaveBeenCalled()
  })

  it('tabs mode is a framed card, not a bare absolute fill', async () => {
    setBrain({ kind: 'text', content: 'x' })
    const { container } = renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    await screen.findByLabelText('editor')
    const paneEl = container.firstChild as HTMLElement
    expect(paneEl.className).toContain('rounded-lg')
    expect(paneEl.className).toContain('overflow-hidden')
    const body = screen.getByLabelText('editor').parentElement as HTMLElement
    expect(body.className).toContain('flex-1')
    expect(body.className).not.toContain('absolute')
  })

  it('image / binary / too-large / missing render their fallbacks', async () => {
    setBrain({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' })
    const r1 = renderPane({ pane: { id: 'p3', path: '/p/x.png', name: 'x.png' } })
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    r1.unmount()

    setBrain({ kind: 'binary' })
    const onOpenExternally = vi.fn()
    const r2 = renderPane({ pane: { id: 'p4', path: '/p/x.bin', name: 'x.bin' }, onOpenExternally })
    expect(await screen.findByText(/binary file/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open externally' }))
    expect(onOpenExternally).toHaveBeenCalled()
    r2.unmount()

    setBrain({ kind: 'too-large', size: 99 })
    const r3 = renderPane({ pane: { id: 'p5', path: '/p/big.txt', name: 'big.txt' } })
    expect(await screen.findByText(/too large/i)).toBeInTheDocument()
    r3.unmount()

    setBrain({ kind: 'missing' })
    renderPane({ pane: { id: 'p6', path: '/p/gone.txt', name: 'gone.txt' } })
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })

  it('a failed save shows the error strip; the next successful save clears it', async () => {
    setBrain({ kind: 'text', content: 'a' })
    brain.saveFile.mockResolvedValueOnce({ ok: false, error: 'EACCES' })
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    const editor = await screen.findByLabelText('editor')
    vi.useFakeTimers()
    const type = (v: string) => act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(editor, v)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    type('ab')
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10) })
    vi.useRealTimers()
    expect(await screen.findByText(/EACCES/)).toBeInTheDocument()
    vi.useFakeTimers()
    type('abc')
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10) })
    vi.useRealTimers()
    await waitFor(() => expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument())
  })
})

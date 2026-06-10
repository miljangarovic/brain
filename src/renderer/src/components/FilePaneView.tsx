import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilePane } from '@shared/types'
import type { FileLoadResult } from '@shared/files'
import { CodeEditor } from './CodeEditor'
import { MarkdownView } from './MarkdownView'
import { FileCodeIcon } from './icons'
import { MONO_FONT } from '../theme'

export const SAVE_DEBOUNCE_MS = 500

const ACTIVE_PANE_SHADOW =
  '0 0 0 1px var(--od-accent), 0 0 0 4px color-mix(in srgb, var(--od-accent) 16%, transparent), 0 12px 30px -16px rgba(0,0,0,0.75)'

// One open file. Mirrors TerminalPane's two shapes (gridded card / tabs fill)
// but mounts only while its feature is shown — there is no live process to
// preserve. Auto-save is debounced and ALWAYS flushed on unmount/beforeunload:
// a pane never disappears with unsaved keystrokes.
export function FilePaneView({
  pane, active, gridded, gridRowSpan, gridColSpan, visibleInTabs, onActivate, onClose, onSetMdView, onOpenExternally
}: {
  pane: FilePane
  active: boolean
  gridded: boolean
  gridRowSpan?: number
  gridColSpan?: number
  visibleInTabs: boolean
  onActivate: () => void
  onClose: () => void
  onSetMdView: (view: 'rendered' | 'raw') => void
  onOpenExternally: () => void
}) {
  const [load, setLoad] = useState<FileLoadResult | { kind: 'loading' }>({ kind: 'loading' })
  const [doc, setDoc] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const savedRef = useRef('')   // last content we wrote or accepted from disk
  const dirtyRef = useRef(false)
  const docRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSave = useCallback((text: string) => {
    savedRef.current = text
    dirtyRef.current = false
    void window.brain.saveFile(pane.path, text).then((res) => {
      if (res.ok) setSaveError(null)
      else { setSaveError(res.error); dirtyRef.current = true }
    })
  }, [pane.path])

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (dirtyRef.current) doSave(docRef.current)
  }, [doSave])

  const onChange = (text: string) => {
    docRef.current = text
    setDoc(text)
    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { timerRef.current = null; doSave(docRef.current) }, SAVE_DEBOUNCE_MS)
  }

  const reload = useCallback(async () => {
    const res = await window.brain.loadFile(pane.path)
    if (res.kind === 'text') {
      if (res.content !== savedRef.current) {
        if (dirtyRef.current) return  // user mid-edit: the debounced save wins
        savedRef.current = res.content
        docRef.current = res.content
        setDoc(res.content)
      }
    }
    setLoad(res)
  }, [pane.path])

  // Load on mount; watch for external changes; flush pending edits on unmount
  // and on app close — a pane must never disappear with unsaved keystrokes.
  useEffect(() => {
    void reload()
    window.brain.watchFile(pane.id, pane.path)
    const offChanged = window.brain.onFsChanged((watchId) => { if (watchId === pane.id) void reload() })
    window.addEventListener('beforeunload', flush)
    return () => {
      flush() // unmount inside the debounce window must still save
      window.removeEventListener('beforeunload', flush)
      offChanged()
      window.brain.unwatchFile(pane.id)
    }
  }, [pane.id, pane.path, reload, flush])

  const isMd = /\.(md|markdown)$/i.test(pane.path)
  const mdView = pane.mdView ?? 'rendered'
  const showRendered = isMd && mdView === 'rendered' && load.kind === 'text'

  const toggleBtn = (on: boolean) =>
    `px-2 py-0.5 text-[11px] rounded transition-colors ${on ? 'bg-accent text-surface' : 'text-fg-muted hover:text-fg hover:bg-hover'}`

  const body = () => {
    switch (load.kind) {
      case 'loading':
        return <div className="flex h-full items-center justify-center text-sm text-fg-muted">Loading…</div>
      case 'text':
        return showRendered ? <MarkdownView source={doc} /> : <CodeEditor value={doc} path={pane.path} onChange={onChange} />
      case 'image':
        return (
          <div className="flex h-full items-center justify-center overflow-auto bg-surface p-4">
            <img src={load.dataUrl} alt={pane.name} className="max-h-full max-w-full object-contain" />
          </div>
        )
      case 'binary':
      case 'too-large':
      case 'missing': {
        const msg = load.kind === 'binary'
          ? 'Binary file — cannot display it here.'
          : load.kind === 'too-large'
            ? `File too large to display (${Math.round(load.size / 1024 / 1024)} MB).`
            : 'File not found on disk.'
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-muted">
            <FileCodeIcon className="text-2xl opacity-60" />
            <span className="text-sm">{msg}</span>
            {load.kind !== 'missing' && (
              <button
                onClick={onOpenExternally}
                className="rounded-md px-3 py-1.5 text-sm text-fg ring-1 ring-line hover:bg-hover transition-colors"
              >
                Open externally
              </button>
            )}
          </div>
        )
      }
    }
  }

  const gridStyle = gridded
    ? {
        ...(active ? { boxShadow: ACTIVE_PANE_SHADOW } : {}),
        ...(gridRowSpan && gridRowSpan > 1 ? { gridRow: `span ${gridRowSpan}` } : {}),
        ...(gridColSpan && gridColSpan > 1 ? { gridColumn: `span ${gridColSpan}` } : {})
      }
    : { display: visibleInTabs ? 'block' : 'none' }

  return (
    <div
      onMouseDown={gridded ? onActivate : undefined}
      className={gridded
        ? `relative flex flex-col min-h-0 min-w-0 overflow-hidden rounded-lg bg-surface border transition-colors duration-150 ${
            active ? 'border-accent' : 'border-divider hover:border-fg-muted'}`
        : 'absolute inset-0'}
      style={gridStyle}
    >
      {gridded && (
        <div className={`flex items-center gap-2 h-7 shrink-0 px-2.5 border-b border-line text-xs select-none transition-colors ${
          active ? 'bg-elevated text-fg-bright' : 'bg-panel text-fg-muted'}`}>
          <FileCodeIcon className="shrink-0 text-fg-muted" />
          <span className="truncate font-medium tracking-wide" style={{ fontFamily: MONO_FONT }}>{pane.name}</span>
          <button
            aria-label={`Close ${pane.name}`}
            title="Close file"
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="ml-auto text-fg-muted hover:text-fg transition-colors"
          >
            ×
          </button>
        </div>
      )}
      <div className={gridded ? 'relative flex-1 min-h-0' : 'absolute inset-0'}>
        {saveError && (
          <div className="absolute inset-x-0 top-0 z-10 truncate bg-rose-500/90 px-3 py-1 text-xs text-white">
            Save failed: {saveError} — {pane.path}
          </div>
        )}
        {isMd && load.kind === 'text' && (
          <div className="absolute right-2 top-1.5 z-10 flex gap-0.5 rounded-md border border-line bg-elevated/90 p-0.5">
            <button aria-label="Rendered view" className={toggleBtn(mdView === 'rendered')}
              onClick={() => { flush(); onSetMdView('rendered') }}>MD</button>
            <button aria-label="Raw view" className={toggleBtn(mdView === 'raw')}
              onClick={() => onSetMdView('raw')}>Raw</button>
          </div>
        )}
        {body()}
      </div>
    </div>
  )
}

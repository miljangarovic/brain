import { useEffect, useState } from 'react'
import type { AttentionState } from '../attention/detect'
import { AttentionDot } from './AttentionDot'
import { BellIcon, SpeakerIcon, SpeakerMutedIcon, TrashIcon } from './icons'

export interface AttentionBellItem {
  terminalId: string
  state: AttentionState
  lastLine: string
  path: string
}

// Global "who needs me" control: a bell with a count at the top of the sidebar,
// opening a queue popover. Cross-project — it surfaces agents in any project.
export function AttentionBell(props: {
  items: AttentionBellItem[]
  muted: boolean
  onSelect: (terminalId: string) => void
  onClear: (terminalId: string) => void
  onClearAll: () => void
  onToggleMute: () => void
}) {
  const { items, muted, onSelect, onClear, onClearAll, onToggleMute } = props
  const [open, setOpen] = useState(false)
  const count = items.length

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <button
        aria-label={`Attention — ${count} terminal(s) waiting`}
        onClick={() => setOpen((o) => !o)}
        className={`relative flex items-center gap-1.5 w-full px-2 py-1 rounded-md text-sm transition ${
          count > 0 ? 'text-amber-300 hover:bg-hover' : 'text-fg-muted hover:bg-hover'}`}
      >
        <BellIcon className="shrink-0" />
        <span className="flex-1 text-left truncate">Pažnja</span>
        {count > 0 && (
          <span className="shrink-0 min-w-5 px-1.5 text-center rounded-full bg-amber-400 text-[11px] font-semibold text-black">
            {count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-30 mt-1 rounded-md border border-line bg-panel shadow-lg overflow-hidden">
            {count === 0 ? (
              <div className="px-3 py-3 text-sm text-fg-muted">Niko te ne čeka.</div>
            ) : (
              <ul className="max-h-80 overflow-y-auto py-1">
                {items.map((it) => (
                  <li key={it.terminalId} className="group flex items-center gap-2 px-2 py-1.5 hover:bg-hover">
                    <AttentionDot state={it.state} />
                    <button
                      className="flex-1 min-w-0 text-left"
                      onClick={() => { onSelect(it.terminalId); setOpen(false) }}
                    >
                      <div className="truncate text-sm text-fg-bright">{it.path}</div>
                      {it.lastLine && <div className="truncate text-xs text-fg-muted">{it.lastLine}</div>}
                    </button>
                    <button
                      aria-label={`Clear ${it.path}`}
                      title="Ukloni iz liste"
                      onClick={() => onClear(it.terminalId)}
                      className="opacity-0 group-hover:opacity-100 px-1 text-fg-muted hover:text-danger transition"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
              <button
                aria-label={muted ? 'Unmute' : 'Mute'}
                title={muted ? 'Uključi zvuk' : 'Isključi zvuk'}
                onClick={onToggleMute}
                className="px-1 text-fg-muted hover:text-fg transition"
              >
                {muted ? <SpeakerMutedIcon /> : <SpeakerIcon />}
              </button>
              <button
                onClick={() => { onClearAll(); setOpen(false) }}
                disabled={count === 0}
                className="px-2 py-0.5 text-xs rounded text-fg-muted hover:text-fg disabled:opacity-40 transition"
              >
                Clear all
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

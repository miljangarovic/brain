import type { ExportProgress, ExportSessionState } from '@shared/exportTypes'
import { SpinnerIcon } from './icons'

export interface ExportNotice { text: string; path?: string }

const STATE_ICON: Record<Exclude<ExportSessionState, 'running'>, { glyph: string; cls: string }> = {
  pending: { glyph: '·', cls: 'text-fg-muted' },
  done: { glyph: '✓', cls: 'text-accent' },
  error: { glyph: '✕', cls: 'text-danger' }
}

// Bottom-right toast for export/import: a percentage bar plus per-session
// status list while an export runs, then a dismissible result line (also
// reused for import results).
export function ExportToast({ progress, notice, onDismiss }: {
  progress: ExportProgress | null
  notice: ExportNotice | null
  onDismiss: () => void
}) {
  if (!progress && !notice) return null
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  // No aria-atomic: with 2N snapshot updates per export, atomically
  // re-announcing the whole session list would flood screen readers —
  // role="status" alone (polite, incremental) is the right verbosity.
  return (
    <div role="status" aria-live="polite" className="fixed bottom-3 right-3 z-50 w-80 max-w-[90vw] rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg shadow-xl shadow-black/50">
      {progress ? (
        progress.total === 0 ? (
          <div className="flex items-center gap-2">
            <SpinnerIcon className="shrink-0 text-accent" />
            <span>Writing archive…</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Exporting — {pct}%</span>
              <span className="text-fg-muted">{progress.done}/{progress.total}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sel">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <ul className="mt-1.5 max-h-36 overflow-y-auto">
              {/* items keep a stable order for the whole export — index key is safe */}
              {progress.items.map((it, i) => (
                <li key={i} className="flex items-center gap-2 py-0.5 text-xs">
                  {it.state === 'running'
                    ? <SpinnerIcon className="shrink-0 text-accent" />
                    : <span className={`w-3 shrink-0 text-center ${STATE_ICON[it.state].cls}`}>{STATE_ICON[it.state].glyph}</span>}
                  <span className={`truncate ${it.state === 'pending' ? 'text-fg-muted' : ''}`}>{it.label}</span>
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 break-words">{notice!.text}</span>
          {notice!.path && (
            <button type="button" onClick={() => window.brain.showItemInFolder(notice!.path!)}
              className="shrink-0 rounded border border-divider px-1.5 py-0.5 text-xs text-fg-muted transition hover:border-accent hover:text-accent">
              Show in folder
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 px-1 text-fg-muted transition hover:text-fg">✕</button>
        </div>
      )}
    </div>
  )
}

import type { ExportProgress } from '@shared/exportTypes'
import { SpinnerIcon } from './icons'

// Bottom-right toast for export/import: live summarization progress while an
// export runs, then a dismissible result line (also reused for import results).
export function ExportToast({ progress, notice, onDismiss }: {
  progress: ExportProgress | null
  notice: string | null
  onDismiss: () => void
}) {
  if (!progress && !notice) return null
  return (
    <div role="status" className="fixed bottom-3 right-3 z-50 flex max-w-md items-center gap-2 rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg shadow-xl shadow-black/50">
      {progress ? (
        <>
          <SpinnerIcon className="shrink-0 text-accent" />
          <span className="truncate">
            Summarizing sessions {progress.done}/{progress.total}{progress.current ? ` — ${progress.current}` : ''}
          </span>
        </>
      ) : (
        <>
          <span className="min-w-0 break-words">{notice}</span>
          <button aria-label="Dismiss" onClick={onDismiss} className="shrink-0 px-1 text-fg-muted transition hover:text-fg">✕</button>
        </>
      )}
    </div>
  )
}

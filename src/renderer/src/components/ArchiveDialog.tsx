import { useEffect } from 'react'
import type { Group } from '@shared/types'
import { TrashIcon } from './icons'
import { useBackdropDismiss } from './useBackdropDismiss'

export function ArchiveDialog({
  group, onArchive, onRestore, onDeleteArchived, onClose
}: {
  group: Group
  onArchive: (featureId: string) => void
  onRestore: (featureId: string) => void
  onDeleteArchived: (featureId: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const archived = group.archivedFeatures ?? []
  const row = 'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover'
  const heading = 'mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted'
  const actionBtn = 'shrink-0 rounded-md px-2.5 py-1 text-xs text-fg ring-1 ring-line hover:bg-hover transition-colors'
  const count = (n: number) => `${n} terminal${n === 1 ? '' : 's'}`

  const backdrop = useBackdropDismiss(onClose)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" {...backdrop}>
      <div className="w-[28rem] max-h-[70vh] overflow-y-auto rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-fg-bright">Archive — {group.name}</h2>
          <button aria-label="Close archive" onClick={onClose}
            className="rounded-md px-2 py-0.5 text-fg-muted transition-colors hover:bg-hover hover:text-fg">✕</button>
        </div>

        <h3 className={heading}>Active</h3>
        {group.features.length === 0 && <p className="px-2 py-1 text-sm text-fg-muted">No active features.</p>}
        {group.features.map((f) => (
          <div key={f.id} className={row}>
            <span className="flex-1 truncate text-sm text-fg">{f.name}</span>
            <span className="shrink-0 text-xs text-fg-muted">{count(f.terminals.length)}</span>
            <button aria-label={`Archive feature ${f.name}`} onClick={() => onArchive(f.id)} className={actionBtn}>Archive</button>
          </div>
        ))}

        <h3 className={`mt-4 ${heading}`}>Archived</h3>
        {archived.length === 0 && <p className="px-2 py-1 text-sm text-fg-muted">Nothing archived yet.</p>}
        {archived.map((f) => (
          <div key={f.id} className={row}>
            <span className="flex-1 truncate text-sm text-fg">{f.name}</span>
            <span className="shrink-0 text-xs text-fg-muted">{count(f.terminals.length)}</span>
            <button aria-label={`Restore feature ${f.name}`} onClick={() => onRestore(f.id)} className={actionBtn}>Restore</button>
            <button aria-label={`Delete archived feature ${f.name}`} title="Delete permanently"
              onClick={() => onDeleteArchived(f.id)}
              className="shrink-0 rounded-md px-1.5 py-1 text-base leading-none text-fg-muted transition-colors hover:bg-hover hover:text-danger"><TrashIcon /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

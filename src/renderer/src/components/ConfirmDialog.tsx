import { useEffect, useRef } from 'react'

export function ConfirmDialog({
  message, confirmLabel = 'Delete', onConfirm, onCancel
}: {
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { confirmRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase + stop: Escape dismisses only the topmost dialog.
      // ConfirmDialog (z-[60]) stacks above ArchiveDialog (z-50); without this,
      // ArchiveDialog's own window listener (registered first) would also fire.
      // Stopping propagation also prevents the key from leaking into a focused terminal.
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[24rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <p className="mb-4 text-sm text-fg-bright">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors">Cancel</button>
          <button ref={confirmRef} onClick={onConfirm} className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90 transition">{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

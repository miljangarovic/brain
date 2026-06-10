// All voice UI in one component, switched on the machine state: a top pill
// while listening/processing, a centered modal for confirm (ConfirmDialog's
// pattern: window keydown in capture phase so Enter/Escape never leak into a
// focused terminal), and a bottom-right toast for results/errors (ExportToast
// placement).
import { useEffect, useRef, useState } from 'react'
import { SpinnerIcon } from './icons'
import type { VoiceUiState } from '../voice/machine'

export function VoiceOverlay({ state, onConfirm, onCancel }: {
  state: VoiceUiState
  onConfirm: (editedPrompt?: string) => void
  onCancel: () => void
}) {
  const isConfirm = state.kind === 'confirm'
  const hasPrompt = isConfirm && state.editablePrompt !== undefined
  const [prompt, setPrompt] = useState('')
  const promptRef = useRef('')
  const runBtnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (isConfirm) { setPrompt(state.editablePrompt ?? ''); promptRef.current = state.editablePrompt ?? '' }
  }, [isConfirm]) // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the confirm opens
  // When the confirm modal has no textarea, park focus on the Run button so typed
  // keys (including Enter) activate it natively rather than leaking into the terminal.
  useEffect(() => {
    if (isConfirm && !hasPrompt) runBtnRef.current?.focus()
  }, [isConfirm, hasPrompt])

  useEffect(() => {
    // Spec: Esc cancels at ANY stage — listening, processing, downloading,
    // confirm, even a lingering toast/error. Enter only confirms the modal.
    if (state.kind === 'idle') return
    const confirmable = state.kind === 'confirm'
    const withPrompt = confirmable && state.editablePrompt !== undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
      // Shift+Enter keeps inserting newlines into the prompt textarea.
      // Guard: if a button has focus, let the browser activate it natively (e.g.
      // pressing Enter on the focused Cancel button must NOT run the command).
      else if (e.key === 'Enter' && !e.shiftKey && confirmable) {
        if ((e.target as HTMLElement)?.tagName === 'BUTTON') return
        e.preventDefault(); e.stopPropagation()
        onConfirm(withPrompt ? promptRef.current : undefined)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state.kind, isConfirm && state.editablePrompt, onConfirm, onCancel]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === 'idle') return null

  if (state.kind === 'listening' || state.kind === 'processing' || state.kind === 'downloading') {
    return (
      <div className="fixed left-1/2 top-3 z-[70] -translate-x-1/2 rounded-full border border-line bg-elevated px-4 py-2 text-sm text-fg shadow-xl shadow-black/50 flex items-center gap-2">
        {state.kind === 'listening' ? (
          <>
            <span className="h-2.5 w-2.5 rounded-full bg-danger animate-pulse" />
            <span>Listening… pause or press the shortcut to finish · Esc cancels</span>
          </>
        ) : state.kind === 'downloading' ? (
          <>
            <SpinnerIcon className="shrink-0 text-accent" />
            <span>Downloading voice model… {state.total ? `${Math.round((state.received / state.total) * 100)}%` : `${Math.round(state.received / 1e6)} MB`}</span>
          </>
        ) : (
          <>
            <SpinnerIcon className="shrink-0 text-accent" />
            <span>{state.label}</span>
            {state.transcript && <span className="text-fg-muted">"{state.transcript}"</span>}
          </>
        )}
      </div>
    )
  }

  if (state.kind === 'confirm') {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
        <div className="w-[28rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
          <p className="mb-1 text-xs text-fg-muted">"{state.transcript}"</p>
          <p className="mb-3 text-sm text-fg-bright">{state.summary}</p>
          {hasPrompt && (
            <textarea
              autoFocus
              rows={4}
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); promptRef.current = e.target.value }}
              className="mb-3 w-full resize-y rounded-md border border-line bg-panel p-2 text-sm text-fg outline-none focus:border-accent"
            />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors">Cancel (Esc)</button>
            <button ref={runBtnRef} onClick={() => onConfirm(hasPrompt ? prompt : undefined)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90 transition">
              Run (Enter)
            </button>
          </div>
        </div>
      </div>
    )
  }

  // toast | error — bottom-right, ExportToast's spot.
  const isError = state.kind === 'error'
  return (
    <div role="status" aria-live="polite" className="fixed bottom-3 right-3 z-[70] w-80 max-w-[90vw] rounded-md border border-line bg-elevated px-3 py-2 text-sm shadow-xl shadow-black/50">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className={isError ? 'text-danger' : 'text-fg'}>{isError ? state.message : state.text}</span>
          {isError && state.transcript && <p className="mt-0.5 text-xs text-fg-muted">"{state.transcript}"</p>}
        </div>
        <button type="button" aria-label="Dismiss" onClick={onCancel} className="shrink-0 px-1 text-fg-muted transition hover:text-fg">✕</button>
      </div>
    </div>
  )
}

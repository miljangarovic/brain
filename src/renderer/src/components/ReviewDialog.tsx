import { useEffect, useState } from 'react'
import type { ReviewPhase } from '@shared/types'
import type { AgentKind } from '../agents'
import { PHASE_ORDER, PHASE_LABEL } from '../review/phases'
import { useBackdropDismiss } from './useBackdropDismiss'

export interface ReviewStartArgs {
  reviewers: AgentKind[]
  phase: ReviewPhase
  maxRounds: number
  specPath?: string
  intent: string
}

export function ReviewDialog({
  originName, defaultReviewer, activeKinds, cwd, onStart, onCancel
}: {
  originName: string
  defaultReviewer: AgentKind
  activeKinds: AgentKind[]   // kinds already reviewing this origin — locked out
  cwd: string
  onStart: (args: ReviewStartArgs) => void
  onCancel: () => void
}) {
  const [reviewers, setReviewers] = useState<AgentKind[]>(
    () => (activeKinds.includes(defaultReviewer) ? [] : [defaultReviewer])
  )
  const [phase, setPhase] = useState<ReviewPhase>('spec')
  const [maxRounds, setMaxRounds] = useState('3')
  const [specPath, setSpecPath] = useState('')
  const [intent, setIntent] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Prefill a suggested spec only when the spec field is relevant (spec/impl phases).
  useEffect(() => {
    if (phase === 'intent' || specPath) return
    let cancelled = false
    window.brain.suggestSpec(cwd).then((p) => { if (!cancelled && p) setSpecPath(p) })
    return () => { cancelled = true }
  }, [phase, cwd, specPath])

  const browse = async () => {
    const p = await window.brain.pickFile({ defaultPath: specPath || cwd })
    if (p) setSpecPath(p)
  }

  const toggleReviewer = (k: AgentKind) =>
    setReviewers((rs) => (rs.includes(k) ? rs.filter((x) => x !== k) : [...rs, k]))

  const submit = () => {
    if (reviewers.length === 0) return
    onStart({
      reviewers, phase, maxRounds: Math.max(1, parseInt(maxRounds, 10) || 1),
      specPath: phase === 'intent' ? undefined : (specPath.trim() || undefined),
      intent: intent.trim()
    })
  }

  const backdrop = useBackdropDismiss(onCancel)

  const field = 'mt-1 w-full rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition'
  const seg = (active: boolean) =>
    `px-3 py-1 text-sm rounded-md transition ${active ? 'bg-accent text-surface' : 'bg-field text-fg-muted hover:text-fg'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" {...backdrop}>
      <div className="w-[30rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold tracking-tight text-fg-bright">Review</h2>
        <p className="mb-4 text-xs text-fg-muted">Reviewing terminal "{originName}".</p>

        <div className="mb-3">
          <span className="text-sm text-fg">Reviewer</span>
          <div className="mt-1 flex gap-2">
            {(['claude', 'codex'] as AgentKind[]).map((k) => (
              <button key={k} type="button" disabled={activeKinds.includes(k)}
                aria-pressed={reviewers.includes(k)}
                title={activeKinds.includes(k) ? `${k} is already reviewing this terminal` : undefined}
                className={`${seg(reviewers.includes(k))} disabled:opacity-40 disabled:cursor-not-allowed`}
                onClick={() => toggleReviewer(k)}>
                {k === 'claude' ? 'Claude' : 'Codex'}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <span className="text-sm text-fg">Start phase</span>
          <div className="mt-1 flex gap-2">
            {PHASE_ORDER.map((p) => (
              <button key={p} type="button" aria-label={PHASE_LABEL[p]} aria-pressed={phase === p}
                className={seg(phase === p)} onClick={() => setPhase(p)}>{PHASE_LABEL[p]}</button>
            ))}
          </div>
        </div>

        <label className="block mb-3 text-sm text-fg">
          Max rounds
          <input aria-label="Max rounds" type="text" inputMode="numeric" value={maxRounds}
            onChange={(e) => { if (/^\d*$/.test(e.target.value)) setMaxRounds(e.target.value) }}
            className={field} />
        </label>

        {phase !== 'intent' && (
          <label className="block mb-3 text-sm text-fg">
            Spec file
            <div className="mt-1 flex gap-2">
              <input aria-label="Spec file" value={specPath} onChange={(e) => setSpecPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field.replace('mt-1 ', '')} />
              <button type="button" onClick={browse} className="shrink-0 rounded-md bg-field px-3 text-sm text-fg-muted hover:text-fg transition">Browse…</button>
            </div>
          </label>
        )}

        <label className="block mb-4 text-sm text-fg">
          Intent (optional)
          <input aria-label="Intent (optional)" value={intent} placeholder="what's the goal…"
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field} />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors">Cancel</button>
          <button onClick={submit} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:bg-accent-strong transition-colors">Start review</button>
        </div>
      </div>
    </div>
  )
}

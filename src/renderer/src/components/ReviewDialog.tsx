import { useEffect, useState } from 'react'
import type { ReviewKind } from '@shared/types'
import type { AgentKind } from '../agents'

export interface ReviewStartArgs {
  reviewer: AgentKind
  kind: ReviewKind
  specPath?: string
  intent: string
}

export function ReviewDialog({
  originName, defaultReviewer, cwd, onStart, onCancel
}: {
  originName: string
  defaultReviewer: AgentKind
  cwd: string
  onStart: (args: ReviewStartArgs) => void
  onCancel: () => void
}) {
  const [reviewer, setReviewer] = useState<AgentKind>(defaultReviewer)
  const [kind, setKind] = useState<ReviewKind>('spec')
  const [specPath, setSpecPath] = useState('')
  const [intent, setIntent] = useState('')

  useEffect(() => {
    let cancelled = false
    window.orchestrix.suggestSpec(cwd).then((p) => { if (!cancelled && p) setSpecPath(p) })
    return () => { cancelled = true }
  }, [cwd])

  const browse = async () => {
    const p = await window.orchestrix.pickFile({ defaultPath: specPath || cwd })
    if (p) setSpecPath(p)
  }

  const submit = () => {
    if (kind === 'spec' && !specPath.trim()) return
    onStart({ reviewer, kind, specPath: kind === 'spec' ? specPath.trim() : undefined, intent: intent.trim() })
  }

  const field = 'mt-1 w-full rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition'
  const seg = (active: boolean) =>
    `px-3 py-1 text-sm rounded-md transition ${active ? 'bg-accent text-surface' : 'bg-field text-fg-muted hover:text-fg'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[30rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold tracking-tight text-fg-bright">Review</h2>
        <p className="mb-4 text-xs text-fg-muted">Reviewing terminal “{originName}”.</p>

        <div className="mb-3">
          <span className="text-sm text-fg">Reviewer</span>
          <div className="mt-1 flex gap-2">
            <button type="button" className={seg(reviewer === 'claude')} onClick={() => setReviewer('claude')}>Claude</button>
            <button type="button" className={seg(reviewer === 'codex')} onClick={() => setReviewer('codex')}>Codex</button>
          </div>
        </div>

        <div className="mb-3">
          <span className="text-sm text-fg">Type</span>
          <div className="mt-1 flex gap-2">
            <button type="button" aria-label="Spec/plan" aria-pressed={kind === 'spec'} className={seg(kind === 'spec')} onClick={() => setKind('spec')}>Spec/plan</button>
            <button type="button" aria-label="Implementation" aria-pressed={kind === 'impl'} className={seg(kind === 'impl')} onClick={() => setKind('impl')}>Implementation</button>
          </div>
        </div>

        {kind === 'spec' ? (
          <label className="block mb-3 text-sm text-fg">
            Spec file
            <div className="mt-1 flex gap-2">
              <input aria-label="Spec file" value={specPath} onChange={(e) => setSpecPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field.replace('mt-1 ', '')} />
              <button type="button" onClick={browse} className="shrink-0 rounded-md bg-field px-3 text-sm text-fg-muted hover:text-fg transition">Browse…</button>
            </div>
          </label>
        ) : (
          <p className="mb-3 text-sm text-fg-muted">Artifact: <code className="text-fg">git diff</code> in <code className="text-fg">{cwd || '~'}</code>.</p>
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

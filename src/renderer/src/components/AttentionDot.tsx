import type { AttentionState } from '../attention/detect'

// A small status dot shown next to a terminal that needs the user. Distinct
// palette from ReviewStatusDot; the two never co-occur (review terminals are
// skipped by attention routing).
export function AttentionDot({ state }: { state: AttentionState | undefined }) {
  if (!state) return null
  if (state === 'waiting-input')
    return <span data-testid="attn-waiting" title="Čeka tvoj odgovor" className="shrink-0 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
  if (state === 'error')
    return <span data-testid="attn-error" title="Pao s greškom" className="shrink-0 h-2 w-2 rounded-full bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)]" />
  return <span data-testid="attn-done" title="Gotov — čeka te" className="shrink-0 h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.7)]" />
}

import { GridIcon } from './icons'
import { AddMenuButton, type AddKind } from './AddMenuButton'

export interface ReviewControl {
  reviewerId: string | null
  needsDecision: boolean // maxRounds reached
  active: boolean        // loop running (reviewing or applying)
}

export function FeatureHeader({
  featureName, viewMode, onToggleView, onAdd,
  review, onMoreRounds, onAcceptPhase, onStopLoop
}: {
  featureName: string
  viewMode: 'tabs' | 'grid'
  onToggleView: () => void
  onAdd: (kind: AddKind) => void
  review: ReviewControl
  onMoreRounds: (reviewerId: string) => void
  onAcceptPhase: (reviewerId: string) => void
  onStopLoop: (reviewerId: string) => void
}) {
  const rid = review.reviewerId
  const btn = 'px-2 text-xs rounded bg-field text-accent hover:bg-hover transition'
  const btnMuted = 'px-2 text-xs rounded bg-field text-fg-muted hover:text-fg transition'
  return (
    <div className="flex items-center gap-2 h-9 px-3 bg-panel border-b border-line">
      <span className="truncate text-sm font-medium text-fg-bright">{featureName}</span>
      <div className="ml-auto flex items-center gap-0.5 text-base leading-none">
        {rid && review.needsDecision && (
          <>
            <button onClick={() => onMoreRounds(rid)} title="Run more rounds" className={btn}>Još rundi</button>
            <button onClick={() => onAcceptPhase(rid)} title="Accept as approved (reviewer closes)" className={btnMuted}>Prihvati ovako</button>
            <button onClick={() => onStopLoop(rid)} title="Stop the review loop" className={btnMuted}>Stop</button>
          </>
        )}
        {rid && review.active && !review.needsDecision && (
          <button onClick={() => onStopLoop(rid)} title="Stop the review loop" className={btnMuted}>Stani petlju</button>
        )}
        <button
          aria-label={viewMode === 'grid' ? 'Tabs view' : 'Grid view'}
          aria-pressed={viewMode === 'grid'}
          title={viewMode === 'grid' ? 'Switch to tabs' : 'Switch to grid'}
          onClick={onToggleView}
          className={`px-1.5 transition-colors ${viewMode === 'grid' ? 'text-accent' : 'text-fg-muted hover:text-accent'}`}
        >
          <GridIcon />
        </button>
        <AddMenuButton onAdd={onAdd} className="px-1.5 text-sm text-fg-muted hover:text-accent transition-colors" />
      </div>
    </div>
  )
}

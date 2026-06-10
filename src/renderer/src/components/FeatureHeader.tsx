import type { GridStyle } from '@shared/types'
import { GridIcon, LayoutBigLeftIcon, LayoutBigRightIcon, LayoutBigTopIcon, LayoutBigBottomIcon, LayoutRowsIcon, LayoutColsIcon } from './icons'
import { AddMenuButton, type AddKind } from './AddMenuButton'

export interface ReviewControl {
  reviewerId: string | null
  needsDecision: boolean // maxRounds reached
  active: boolean        // loop running (reviewing or applying)
}

// The grid-style picker, in display order. Labels double as accessible names.
const GRID_STYLES: { style: GridStyle; label: string; Icon: typeof LayoutBigLeftIcon }[] = [
  { style: 'auto-left', label: 'Big pane left', Icon: LayoutBigLeftIcon },
  { style: 'auto', label: 'Big pane right', Icon: LayoutBigRightIcon },
  { style: 'auto-top', label: 'Big pane top', Icon: LayoutBigTopIcon },
  { style: 'auto-bottom', label: 'Big pane bottom', Icon: LayoutBigBottomIcon },
  { style: 'rows', label: 'Stack vertically', Icon: LayoutRowsIcon },
  { style: 'cols', label: 'Side by side', Icon: LayoutColsIcon }
]

export function FeatureHeader({
  featureName, viewMode, onToggleView, onAdd,
  review, onMoreRounds, onAcceptPhase, onStopLoop,
  gridStyle, onSetGridStyle
}: {
  featureName: string
  viewMode: 'tabs' | 'grid'
  onToggleView: () => void
  onAdd: (kind: AddKind) => void
  review: ReviewControl
  onMoreRounds: (reviewerId: string) => void
  onAcceptPhase: (reviewerId: string) => void
  onStopLoop: (reviewerId: string) => void
  gridStyle: GridStyle
  onSetGridStyle: (style: GridStyle) => void
}) {
  const rid = review.reviewerId
  // Prominent, filled review controls — they drive the loop, so they must read at a
  // glance: accent for "go", rose for "stop". Muted ghost for the low-stakes accept.
  const goBtn = 'px-3 py-1 text-xs font-semibold rounded-md bg-accent text-surface hover:bg-accent-strong transition shadow-sm shadow-black/25'
  const stopBtn = 'px-3 py-1 text-xs font-semibold rounded-md bg-rose-500/90 text-white hover:bg-rose-500 transition shadow-sm shadow-rose-900/30'
  const ghostBtn = 'px-2.5 py-1 text-xs rounded-md text-fg-muted hover:text-fg hover:bg-hover transition'
  const iconBtn = (on: boolean) => `px-1.5 py-1 rounded-md transition-colors ${on ? 'text-accent bg-hover' : 'text-fg-muted hover:text-accent hover:bg-hover'}`
  const showControls = !!rid && (review.needsDecision || review.active)
  return (
    <div className="flex items-center gap-2.5 h-9 px-3 bg-panel border-b border-line">
      <span className="shrink-0 truncate max-w-[16rem] text-sm font-medium text-fg-bright">{featureName}</span>
      <div className="flex items-center gap-1.5 leading-none">
        {/* The grid toggle leads the cluster so it never shifts when the style
            picker or the review controls appear. */}
        <button
          aria-label={viewMode === 'grid' ? 'Tabs view' : 'Grid view'}
          aria-pressed={viewMode === 'grid'}
          title={viewMode === 'grid' ? 'Switch to tabs' : 'Switch to grid'}
          onClick={onToggleView}
          className={iconBtn(viewMode === 'grid')}
        >
          <GridIcon />
        </button>
        {viewMode === 'grid' && (
          <>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />
            {GRID_STYLES.map(({ style, label, Icon }) => (
              <button
                key={style}
                aria-label={label}
                aria-pressed={gridStyle === style}
                title={label}
                onClick={() => onSetGridStyle(style)}
                className={iconBtn(gridStyle === style)}
              >
                <Icon />
              </button>
            ))}
          </>
        )}
        {showControls && <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />}
        {rid && review.needsDecision && (
          <>
            <button onClick={() => onMoreRounds(rid)} title="Run more review rounds" className={goBtn}>Nastavi</button>
            <button onClick={() => onAcceptPhase(rid)} title="Accept as approved (reviewer closes)" className={ghostBtn}>Prihvati</button>
            <button onClick={() => onStopLoop(rid)} title="Stop the review loop" className={stopBtn}>Zaustavi petlju</button>
          </>
        )}
        {rid && review.active && !review.needsDecision && (
          <button onClick={() => onStopLoop(rid)} title="Stop the review loop" className={stopBtn}>Zaustavi petlju</button>
        )}
        <AddMenuButton onAdd={onAdd} className="px-1.5 py-1 rounded-md text-sm text-fg-muted hover:text-accent hover:bg-hover transition-colors" />
      </div>
    </div>
  )
}

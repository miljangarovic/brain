import { GridIcon } from './icons'
import { AddMenuButton, type AddKind } from './AddMenuButton'

export function FeatureHeader({
  featureName, viewMode, onToggleView, onAdd, relay, onReturnToOrigin, onReReview, onMarkApplied
}: {
  featureName: string
  viewMode: 'tabs' | 'grid'
  onToggleView: () => void
  onAdd: (kind: AddKind) => void
  relay: { canReturn: boolean; canReReview: boolean; canMarkApplied: boolean }
  onReturnToOrigin: () => void
  onReReview: () => void
  onMarkApplied: () => void
}) {
  return (
    <div className="flex items-center gap-2 h-9 px-3 bg-panel border-b border-line">
      <span className="truncate text-sm font-medium text-fg-bright">{featureName}</span>
      <div className="ml-auto flex items-center gap-0.5 text-base leading-none">
        {relay.canReturn && (
          <button onClick={onReturnToOrigin} title="Return the critique to the implementer"
            className="px-2 text-xs rounded bg-field text-accent hover:bg-hover transition">→ Return to A</button>
        )}
        {relay.canReReview && (
          <button onClick={onReReview} title="Send the updated artifact back to the reviewer"
            className="px-2 text-xs rounded bg-field text-accent hover:bg-hover transition">↻ Re-review</button>
        )}
        {relay.canMarkApplied && (
          <button onClick={onMarkApplied} title="Mark iteration done"
            className="px-2 text-xs rounded bg-field text-fg-muted hover:text-fg transition">✓ Done</button>
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

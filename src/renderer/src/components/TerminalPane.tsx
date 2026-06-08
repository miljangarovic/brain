// A single terminal as it appears in the main area. In grid mode it's a titled
// "pane" card (header strip with icon + name + active emphasis); in tabs mode
// it's a bare fill that's shown only when active. The skeleton (outer div →
// body div → TerminalView) is identical in both modes so React preserves the
// live TerminalView/xterm when the user toggles between grid and tabs.
import type { Terminal, ReviewStatus } from '@shared/types'
import { TerminalKindIcon, SpinnerIcon } from './icons'
import { ReviewStatusDot } from './ReviewStatusDot'
import { TerminalView } from './TerminalView'
import { MONO_FONT } from '../theme'

// Active pane: crisp accent edge + a faint accent halo + a soft drop shadow to
// lift it above the panel gutter.
const ACTIVE_PANE_SHADOW =
  '0 0 0 1px var(--od-accent), 0 0 0 4px color-mix(in srgb, var(--od-accent) 16%, transparent), 0 12px 30px -16px rgba(0,0,0,0.75)'

export function TerminalPane({
  terminal, active, gridded, visibleInTabs, busy, liveAgent, reviewStatus, onActivate
}: {
  terminal: Terminal
  active: boolean
  gridded: boolean          // shown as a grid cell (grid mode + in the active feature)
  visibleInTabs: boolean    // shown in tabs mode (active, in feature, not gridded)
  busy: boolean
  liveAgent: 'claude' | 'codex' | undefined
  reviewStatus: ReviewStatus | undefined
  onActivate: () => void
}) {
  return (
    <div
      onMouseDown={gridded ? onActivate : undefined}
      className={gridded
        ? `relative flex flex-col min-h-0 min-w-0 overflow-hidden rounded-lg bg-surface border transition-colors duration-150 ${
            active ? 'border-accent' : 'border-divider hover:border-fg-muted'}`
        : 'absolute inset-0'}
      style={gridded
        ? (active ? { boxShadow: ACTIVE_PANE_SHADOW } : undefined)
        : { display: visibleInTabs ? 'block' : 'none' }}
    >
      {gridded && (
        <div className={`flex items-center gap-2 h-7 shrink-0 px-2.5 border-b border-line text-xs select-none transition-colors ${
          active ? 'bg-elevated text-fg-bright' : 'bg-panel text-fg-muted'}`}>
          {busy
            ? <SpinnerIcon className="shrink-0 text-accent" />
            : <TerminalKindIcon kind={liveAgent ?? terminal.kind ?? 'shell'} className="shrink-0 text-fg-muted" />}
          <span className="truncate font-medium tracking-wide" style={{ fontFamily: MONO_FONT }}>{terminal.name}</span>
          <ReviewStatusDot status={reviewStatus} />
          <span
            className={`ml-auto h-1.5 w-1.5 rounded-full transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
            style={{ background: 'var(--od-accent)', boxShadow: '0 0 6px var(--od-accent)' }}
          />
        </div>
      )}
      <div className={gridded ? 'relative flex-1 min-h-0' : 'absolute inset-0'}>
        <TerminalView terminal={terminal} active={active} />
      </div>
    </div>
  )
}

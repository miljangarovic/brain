// A single terminal as it appears in the main area. In grid mode it's a titled
// "pane" card (header strip with icon + name + active emphasis); in tabs mode
// it's a bare fill that's shown only when active. The skeleton (outer div →
// body div → TerminalView) is identical in both modes so React preserves the
// live TerminalView/xterm when the user toggles between grid and tabs.
import type { Terminal, ReviewStatus } from '@shared/types'
import { TerminalKindIcon, SpinnerIcon } from './icons'
import { ReviewStatusDot } from './ReviewStatusDot'
import { statusDot } from '../review/status'
import { TerminalView } from './TerminalView'
import { MONO_FONT } from '../theme'

// Active pane: crisp accent edge + a faint accent halo + a soft drop shadow to
// lift it above the panel gutter.
const ACTIVE_PANE_SHADOW =
  '0 0 0 1px var(--od-accent), 0 0 0 4px color-mix(in srgb, var(--od-accent) 16%, transparent), 0 12px 30px -16px rgba(0,0,0,0.75)'

// Grid drag-and-drop wiring (set only for gridded panes). The pane *header* is the
// drag handle so the terminal body below stays mouse-selectable; the whole pane is
// the drop zone. Logic/state lives in App; this component only renders + forwards.
export interface PaneDnd {
  dragging: boolean                              // this pane is the one being dragged
  isDropTarget: boolean                          // a drop here would land the dragged pane
  onHandleDragStart: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

export function TerminalPane({
  terminal, active, gridded, gridRowSpan, gridColSpan, visibleInTabs, busy, liveAgent, reviewStatus, onActivate, dnd, resume, started, onStart
}: {
  terminal: Terminal
  active: boolean
  gridded: boolean          // shown as a grid cell (grid mode + in the active feature)
  gridRowSpan?: number      // rows this pane spans (column-flow styles: big pane left/right)
  gridColSpan?: number      // columns this pane spans (row-flow styles: big pane top/bottom)
  visibleInTabs: boolean    // shown in tabs mode (active, in feature, not gridded)
  busy: boolean
  liveAgent: 'claude' | 'codex' | undefined
  reviewStatus: ReviewStatus | undefined
  onActivate: () => void
  dnd?: PaneDnd             // grid reorder handlers (present only for gridded panes)
  resume?: boolean          // restored agent terminal → spawn with its resume command
  started: boolean          // false → boot-restored and never opened: render a cold placeholder, no PTY
  onStart: () => void
}) {
  const gridStyle = gridded
    ? {
        ...(active ? { boxShadow: ACTIVE_PANE_SHADOW } : {}),
        ...(gridRowSpan && gridRowSpan > 1 ? { gridRow: `span ${gridRowSpan}` } : {}),
        ...(gridColSpan && gridColSpan > 1 ? { gridColumn: `span ${gridColSpan}` } : {})
      }
    : { display: visibleInTabs ? 'block' : 'none' }
  return (
    <div
      onMouseDown={gridded ? onActivate : undefined}
      onDragOver={dnd?.onDragOver}
      onDrop={dnd?.onDrop}
      className={gridded
        ? `relative flex flex-col min-h-0 min-w-0 overflow-hidden rounded-lg bg-surface border transition-colors duration-150 ${
            active ? 'border-accent' : 'border-divider hover:border-fg-muted'} ${dnd?.dragging ? 'opacity-40' : ''}`
        : 'absolute inset-0'}
      style={gridStyle}
    >
      {gridded && (
        <div
          draggable={!!dnd}
          onDragStart={dnd?.onHandleDragStart}
          onDragEnd={dnd?.onDragEnd}
          className={`flex items-center gap-2 h-7 shrink-0 px-2.5 border-b border-line text-xs select-none transition-colors ${
          dnd ? 'cursor-grab active:cursor-grabbing' : ''} ${
          active ? 'bg-elevated text-fg-bright' : 'bg-panel text-fg-muted'}`}>
          {/* While the review dot is already spinning, keep the kind icon here —
              two spinners in one header read as noise. */}
          {busy && statusDot(reviewStatus) !== 'spinner'
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
        {started ? (
          <TerminalView terminal={terminal} active={active} resume={resume} />
        ) : (
          // Cold pane: the shell/agent spawns only when the user opens it.
          // Mounting TerminalView is what creates the PTY, so we render this
          // stand-in instead until then.
          <button
            type="button"
            onClick={onStart}
            className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface text-fg-muted hover:text-fg transition-colors"
          >
            <TerminalKindIcon kind={liveAgent ?? terminal.kind ?? 'shell'} className="opacity-60" />
            {!gridded && <span className="text-sm font-medium" style={{ fontFamily: MONO_FONT }}>{terminal.name}</span>}
            <span className="text-xs">
              Click to start{resume && (terminal.kind === 'claude' || terminal.kind === 'codex') ? ' — resumes its session' : ''}
            </span>
          </button>
        )}
      </div>
      {gridded && dnd?.isDropTarget && (
        <div
          className="pointer-events-none absolute inset-0 rounded-lg"
          style={{ boxShadow: 'inset 0 0 0 2px var(--od-accent)', background: 'color-mix(in srgb, var(--od-accent) 12%, transparent)' }}
        />
      )}
    </div>
  )
}

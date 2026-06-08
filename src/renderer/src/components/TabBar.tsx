// src/renderer/src/components/TabBar.tsx
import type { Terminal, ReviewStatus } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ReviewIcon } from './icons'
import { ReviewStatusDot } from './ReviewStatusDot'

export function TabBar({
  terminals, activeId, liveAgents, onSelect, onClose, reviewStatus, onReviewTerminal
}: {
  terminals: Terminal[]
  activeId: string | null
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
  onReviewTerminal: (id: string, reviewer?: AgentKind) => void
}) {
  return (
    <div role="tablist" className="flex items-stretch gap-px h-9 px-2 bg-panel border-b border-line overflow-x-auto">
      {terminals.map((t) => {
        const isActive = t.id === activeId
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.id)}
            className={`group relative flex items-center gap-2 h-full px-3 text-sm cursor-pointer whitespace-nowrap transition-colors ${
              isActive ? 'bg-surface text-fg-bright' : 'text-fg-muted hover:bg-hover hover:text-fg'
            }`}
          >
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
            <ReviewStatusDot status={reviewStatus[t.id]} />
            <span>{t.name}</span>
            <button
              aria-label={`Review ${t.name}`}
              title="Review"
              onClick={(e) => { e.stopPropagation(); onReviewTerminal(t.id) }}
              className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-accent transition"
            >
              <ReviewIcon />
            </button>
            <button
              aria-label={`Zatvori ${t.name}`}
              title={`Sakrij (terminal nastavlja da radi; otvori ga iz sidebar-a)`}
              onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
              className="text-fg-muted hover:text-fg transition-colors"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}

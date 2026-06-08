// src/renderer/src/components/TabBar.tsx
import { useState } from 'react'
import type { Terminal, ReviewStatus } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ReviewIcon, SpinnerIcon } from './icons'
import { ReviewStatusDot } from './ReviewStatusDot'
import { ContextMenu, type MenuItem } from './ContextMenu'

export function TabBar({
  terminals, activeId, liveAgents, onSelect, onClose, reviewStatus, onReviewTerminal, busy
}: {
  terminals: Terminal[]
  activeId: string | null
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
  onReviewTerminal: (id: string, reviewer?: AgentKind) => void
  busy: Record<string, boolean>
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

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
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id: t.id }) }}
            className={`group relative flex items-center gap-2 h-full px-3 text-sm cursor-pointer whitespace-nowrap transition-colors ${
              isActive ? 'bg-surface text-fg-bright' : 'text-fg-muted hover:bg-hover hover:text-fg'
            }`}
          >
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            {busy[t.id]
              ? <SpinnerIcon className="shrink-0 text-accent" />
              : <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />}
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

      {menu && (() => {
        const idx = terminals.findIndex((t) => t.id === menu.id)
        if (idx === -1) return null
        const left = terminals.slice(0, idx)
        const right = terminals.slice(idx + 1)
        const closeAll = (ts: Terminal[]) => ts.forEach((t) => onClose(t.id))
        const items: MenuItem[] = []
        if (left.length + right.length > 0) items.push({ label: 'Zatvori ostale tabove', onSelect: () => closeAll([...left, ...right]) })
        if (left.length > 0) items.push({ label: 'Zatvori sve levo', onSelect: () => closeAll(left) })
        if (right.length > 0) items.push({ label: 'Zatvori sve desno', onSelect: () => closeAll(right) })
        if (items.length === 0) return null
        return <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={items} />
      })()}
    </div>
  )
}

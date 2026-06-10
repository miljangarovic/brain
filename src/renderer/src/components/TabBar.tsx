// src/renderer/src/components/TabBar.tsx
import { useState } from 'react'
import type { Terminal, FilePane, ReviewStatus } from '@shared/types'
import { TerminalKindIcon, SpinnerIcon, FileCodeIcon } from './icons'
import { ReviewStatusDot } from './ReviewStatusDot'
import { statusDot } from '../review/status'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { AttentionDot } from './AttentionDot'
import type { AttentionState } from '../attention/detect'

export type TabItem =
  | { kind: 'terminal'; terminal: Terminal }
  | { kind: 'file'; pane: FilePane }

const itemId = (it: TabItem) => (it.kind === 'terminal' ? it.terminal.id : it.pane.id)
const itemName = (it: TabItem) => (it.kind === 'terminal' ? it.terminal.name : it.pane.name)

export function TabBar({
  items, activeId, liveAgents, onSelect, onClose, onOpenExternally, reviewStatus, busy, attention
}: {
  items: TabItem[]
  activeId: string | null
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onOpenExternally: (path: string) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
  busy: Record<string, boolean>
  attention: Record<string, AttentionState | undefined>
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  return (
    <div role="tablist" className="flex items-stretch gap-px h-9 px-2 bg-panel border-b border-line overflow-x-auto">
      {items.map((it) => {
        const id = itemId(it)
        const name = itemName(it)
        const isActive = id === activeId
        return (
          <div
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(id)}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id }) }}
            className={`group relative flex items-center gap-2 h-full px-3 text-sm cursor-pointer whitespace-nowrap transition-colors ${
              isActive ? 'bg-surface text-fg-bright' : 'text-fg-muted hover:bg-hover hover:text-fg'
            }`}
          >
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            {it.kind === 'terminal' ? (
              <>
                {/* While the review dot is already spinning, keep the kind icon here —
                    two spinners on one tab read as noise. */}
                {busy[id] && liveAgents[id] && statusDot(reviewStatus[id]) !== 'spinner'
                  ? <SpinnerIcon className="shrink-0 text-accent" />
                  : <TerminalKindIcon kind={liveAgents[id] ?? it.terminal.kind ?? 'shell'} className="shrink-0 text-fg-muted" />}
                <ReviewStatusDot status={reviewStatus[id]} />
                <AttentionDot state={attention[id]} />
              </>
            ) : (
              <FileCodeIcon className="shrink-0 text-fg-muted" />
            )}
            <span>{name}</span>
            <button
              aria-label={`Close ${name}`}
              title={it.kind === 'terminal'
                ? `Hide (the terminal keeps running; reopen it from the sidebar)`
                : `Close file`}
              onClick={(e) => { e.stopPropagation(); onClose(id) }}
              className="text-fg-muted hover:text-fg transition-colors"
            >
              ×
            </button>
          </div>
        )
      })}

      {menu && (() => {
        const idx = items.findIndex((it) => itemId(it) === menu.id)
        if (idx === -1) return null
        const item = items[idx]

        if (item.kind === 'file') {
          return <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
            { label: 'Open externally', onSelect: () => onOpenExternally(item.pane.path) },
            { label: 'Close', onSelect: () => onClose(item.pane.id) }
          ]} />
        }

        // terminal item — bulk close sweeps all items (file + terminal alike)
        const left = items.slice(0, idx)
        const right = items.slice(idx + 1)
        const closeAll = (its: TabItem[]) => its.forEach((i) => onClose(itemId(i)))
        const menuItems: MenuItem[] = []
        if (left.length + right.length > 0) menuItems.push({ label: 'Close other tabs', onSelect: () => closeAll([...left, ...right]) })
        if (left.length > 0) menuItems.push({ label: 'Close tabs to the left', onSelect: () => closeAll(left) })
        if (right.length > 0) menuItems.push({ label: 'Close tabs to the right', onSelect: () => closeAll(right) })
        if (menuItems.length === 0) return null
        return <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems} />
      })()}
    </div>
  )
}

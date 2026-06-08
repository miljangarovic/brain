// src/renderer/src/components/TabBar.tsx
import type { Terminal } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ClaudeIcon, CodexIcon, GridIcon } from './icons'

export function TabBar({
  terminals, activeId, viewMode, liveAgents, onSelect, onClose, onAdd, onLaunch, onToggleView
}: {
  terminals: Terminal[]
  activeId: string | null
  viewMode: 'tabs' | 'grid'
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  onLaunch: (kind: AgentKind) => void
  onToggleView: () => void
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
            <span>{t.name}</span>
            <button
              aria-label={`Zatvori ${t.name}`}
              title={`Isključi (terminal ostaje u sidebar-u)`}
              onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
              className="text-fg-muted hover:text-fg transition-colors"
            >
              ×
            </button>
          </div>
        )
      })}
      <div className="ml-1 self-center flex items-center gap-0.5 text-base leading-none">
        <button
          aria-label={viewMode === 'grid' ? 'Tabs prikaz' : 'Grid prikaz'}
          aria-pressed={viewMode === 'grid'}
          title={viewMode === 'grid' ? 'Prebaci na tabove' : 'Prebaci na grid'}
          onClick={onToggleView}
          className={`px-1.5 transition-colors ${viewMode === 'grid' ? 'text-accent' : 'text-fg-muted hover:text-accent'}`}
        >
          <GridIcon />
        </button>
        <button
          aria-label="Novi terminal"
          onClick={onAdd}
          className="px-1.5 text-sm text-fg-muted hover:text-accent transition-colors"
        >
          +
        </button>
        <button
          aria-label="Novi Claude terminal"
          title="Novi Claude terminal"
          onClick={() => onLaunch('claude')}
          className="px-1 opacity-80 hover:opacity-100 transition-opacity"
        >
          <ClaudeIcon />
        </button>
        <button
          aria-label="Novi Codex terminal"
          title="Novi Codex terminal"
          onClick={() => onLaunch('codex')}
          className="px-1 opacity-80 hover:opacity-100 transition-opacity"
        >
          <CodexIcon />
        </button>
      </div>
    </div>
  )
}

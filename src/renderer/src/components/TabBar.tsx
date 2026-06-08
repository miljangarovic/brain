// src/renderer/src/components/TabBar.tsx
import type { Terminal } from '@shared/types'

export function TabBar({
  terminals, activeId, onSelect, onClose, onAdd
}: {
  terminals: Terminal[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
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
              isActive
                ? 'bg-surface text-fg-bright'
                : 'text-fg-muted hover:bg-hover hover:text-fg'
            }`}
          >
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            <span>{t.name}</span>
            <button
              aria-label={`Zatvori ${t.name}`}
              onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
              className="text-fg-muted hover:text-danger transition-colors"
            >
              ×
            </button>
          </div>
        )
      })}
      <button
        aria-label="Novi terminal"
        onClick={onAdd}
        className="ml-1 self-center px-2 text-fg-muted hover:text-accent transition-colors"
      >
        +
      </button>
    </div>
  )
}

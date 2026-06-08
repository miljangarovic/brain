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
    <div role="tablist" className="flex items-center gap-1 h-9 px-2 bg-gray-900 border-b border-gray-700 overflow-x-auto">
      {terminals.map((t) => {
        const isActive = t.id === activeId
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.id)}
            className={`group flex items-center gap-2 h-7 px-3 rounded-t text-sm cursor-pointer whitespace-nowrap ${
              isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            <span>{t.name}</span>
            <button
              aria-label={`Zatvori ${t.name}`}
              onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
              className="text-gray-500 hover:text-white"
            >
              ×
            </button>
          </div>
        )
      })}
      <button aria-label="Novi terminal" onClick={onAdd} className="ml-1 px-2 text-gray-400 hover:text-white">+</button>
    </div>
  )
}

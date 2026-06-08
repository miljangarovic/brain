import { useEffect } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-40 rounded-md border border-line bg-elevated py-1 shadow-xl shadow-black/50"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          onClick={() => { it.onSelect(); onClose() }}
          className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-hover"
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

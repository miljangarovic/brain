import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Close only when the interaction is OUTSIDE the menu (a native target check —
    // React's synthetic stopPropagation can't stop events reaching window).
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // Defer registration by one frame so the very event that opened the menu
    // (the contextmenu/mousedown that set the menu state) can't immediately close it.
    const raf = requestAnimationFrame(() => {
      window.addEventListener('mousedown', onDown)
      window.addEventListener('contextmenu', onDown)
    })
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('contextmenu', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-40 rounded-md border border-line bg-elevated py-1 shadow-xl shadow-black/50"
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

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  icon?: ReactNode
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the menu fully inside the window: measure after layout and shift it
  // left/up if it would overflow the right/bottom edge (e.g. a "+" near the edge).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const m = 8
    let nx = x
    let ny = y
    if (rect.width && x + rect.width > window.innerWidth - m) nx = Math.max(m, window.innerWidth - rect.width - m)
    if (rect.height && y + rect.height > window.innerHeight - m) ny = Math.max(m, window.innerHeight - rect.height - m)
    setPos({ x: nx, y: ny })
  }, [x, y])

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
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 min-w-40 rounded-md border border-line bg-elevated py-1 shadow-xl shadow-black/50"
    >
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          onClick={() => { it.onSelect(); onClose() }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-fg hover:bg-hover"
        >
          {it.icon && <span className="shrink-0 text-base leading-none">{it.icon}</span>}
          {it.label}
        </button>
      ))}
    </div>
  )
}

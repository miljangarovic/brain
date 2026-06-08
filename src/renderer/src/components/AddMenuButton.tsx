import { useState } from 'react'
import { ContextMenu } from './ContextMenu'
import { ClaudeIcon, CodexIcon, ShellIcon } from './icons'

export type AddKind = 'shell' | 'claude' | 'codex'

export function AddMenuButton({
  onAdd, className, title = 'Novi terminal', label = 'Dodaj terminal'
}: {
  onAdd: (kind: AddKind) => void
  className?: string
  title?: string
  label?: string
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        aria-label={label}
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.bottom })
        }}
        className={className}
      >
        +
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Claude', icon: <ClaudeIcon />, onSelect: () => onAdd('claude') },
            { label: 'Codex', icon: <CodexIcon />, onSelect: () => onAdd('codex') },
            { label: 'Terminal', icon: <ShellIcon className="text-fg-muted" />, onSelect: () => onAdd('shell') }
          ]}
        />
      )}
    </>
  )
}

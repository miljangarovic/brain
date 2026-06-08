import { useState } from 'react'
import type { Group } from '@shared/types'

export function Sidebar({
  groups, activeTerminalId, onSelectTerminal, onToggleGroup, onAddGroup, onRenameGroup, onAddTerminal, onDeleteGroup
}: {
  groups: Group[]
  activeTerminalId: string | null
  onSelectTerminal: (id: string) => void
  onToggleGroup: (id: string) => void
  onAddGroup: (name: string) => void
  onRenameGroup: (id: string, name: string) => void
  onAddTerminal: (groupId: string) => void
  onDeleteGroup: (id: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const submitGroup = () => {
    const name = draft.trim()
    if (!name) return
    onAddGroup(name)
    setDraft('')
  }

  const startRename = (id: string, current: string) => {
    setEditingId(id)
    setEditDraft(current)
  }
  const commitRename = () => {
    if (!editingId) return
    const name = editDraft.trim()
    if (name) onRenameGroup(editingId, name)
    setEditingId(null)
  }

  return (
    <div className="w-60 shrink-0 h-full flex flex-col bg-gray-900 border-r border-gray-700 text-gray-300">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Terminaltor</div>

      <div className="flex-1 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.id} className="select-none">
            <div className="group flex items-center gap-1 px-2 py-1 hover:bg-gray-800">
              <button
                aria-label={`Skupi/raširi ${g.name}`}
                onClick={() => onToggleGroup(g.id)}
                className="w-4 text-gray-500"
              >
                {g.collapsed ? '▸' : '▾'}
              </button>
              {editingId === g.id ? (
                <input
                  autoFocus
                  aria-label={`Preimenuj grupu ${g.name}`}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 min-w-0 rounded bg-gray-900 px-1 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
                />
              ) : (
                <span
                  className="flex-1 truncate text-sm font-medium text-gray-200 cursor-text"
                  title="Dvoklik za preimenovanje"
                  onDoubleClick={() => startRename(g.id, g.name)}
                >
                  {g.name}
                </span>
              )}
              <button
                aria-label={`Novi terminal u ${g.name}`}
                onClick={() => onAddTerminal(g.id)}
                className="opacity-0 group-hover:opacity-100 px-1 text-gray-400 hover:text-white"
              >
                +
              </button>
              <button
                aria-label={`Obriši grupu ${g.name}`}
                onClick={() => onDeleteGroup(g.id)}
                className="opacity-0 group-hover:opacity-100 px-1 text-gray-400 hover:text-red-400"
              >
                ×
              </button>
            </div>
            {!g.collapsed && g.terminals.map((t) => (
              <div
                key={t.id}
                onClick={() => onSelectTerminal(t.id)}
                className={`pl-8 pr-2 py-1 text-sm cursor-pointer truncate ${
                  t.id === activeTerminalId ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'
                }`}
              >
                {t.name}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-gray-700">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitGroup() }}
          placeholder="Nova grupa…"
          className="w-full px-2 py-1 text-sm rounded bg-gray-800 text-gray-200 placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  )
}

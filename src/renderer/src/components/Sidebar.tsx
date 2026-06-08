import { useState } from 'react'
import type { Group } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ClaudeIcon, CodexIcon } from './icons'

export function Sidebar({
  groups, activeTerminalId, onSelectTerminal, onToggleGroup, onAddGroup, onRenameGroup, onAddTerminal, onDeleteGroup, onLaunchAgent
}: {
  groups: Group[]
  activeTerminalId: string | null
  onSelectTerminal: (id: string) => void
  onToggleGroup: (id: string) => void
  onAddGroup: (name: string) => void
  onRenameGroup: (id: string, name: string) => void
  onAddTerminal: (groupId: string) => void
  onDeleteGroup: (id: string) => void
  onLaunchAgent: (groupId: string, kind: AgentKind) => void
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

  const hoverBtn = 'opacity-0 group-hover:opacity-100 px-1 text-fg-muted transition'

  return (
    <div className="w-60 shrink-0 h-full flex flex-col bg-panel border-r border-line text-fg">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--od-accent)]" />
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-fg-muted">Terminaltor</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {groups.map((g) => (
          <div key={g.id} className="select-none">
            <div className="group flex items-center gap-1 px-2 py-1 hover:bg-hover">
              <button
                aria-label={`Skupi/raširi ${g.name}`}
                onClick={() => onToggleGroup(g.id)}
                className="w-4 text-fg-muted hover:text-fg transition-colors"
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
                  className="flex-1 min-w-0 rounded bg-field px-1 text-sm text-fg-bright outline-none ring-1 ring-accent"
                />
              ) : (
                <span
                  className="flex-1 truncate text-sm font-medium text-fg-bright cursor-text"
                  title="Dvoklik za preimenovanje"
                  onDoubleClick={() => startRename(g.id, g.name)}
                >
                  {g.name}
                </span>
              )}
              <button
                aria-label={`Novi Claude terminal u ${g.name}`}
                title="Claude"
                onClick={() => onLaunchAgent(g.id, 'claude')}
                className={`${hoverBtn} text-base leading-none`}
              >
                <ClaudeIcon />
              </button>
              <button
                aria-label={`Novi Codex terminal u ${g.name}`}
                title="Codex"
                onClick={() => onLaunchAgent(g.id, 'codex')}
                className={`${hoverBtn} text-base leading-none`}
              >
                <CodexIcon />
              </button>
              <button
                aria-label={`Novi terminal u ${g.name}`}
                onClick={() => onAddTerminal(g.id)}
                className={`${hoverBtn} hover:text-accent`}
              >
                +
              </button>
              <button
                aria-label={`Obriši grupu ${g.name}`}
                onClick={() => onDeleteGroup(g.id)}
                className={`${hoverBtn} hover:text-danger`}
              >
                ×
              </button>
            </div>
            {!g.collapsed && g.terminals.map((t) => {
              const isActive = t.id === activeTerminalId
              return (
                <div
                  key={t.id}
                  data-term-id={t.id}
                  onClick={() => onSelectTerminal(t.id)}
                  className={`flex items-center gap-2 pl-6 pr-2 py-1 text-sm cursor-pointer border-l-2 transition-colors ${
                    isActive
                      ? 'border-accent bg-sel text-fg-bright'
                      : 'border-transparent text-fg hover:bg-hover hover:text-fg-bright'
                  }`}
                >
                  <TerminalKindIcon kind={t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
                  <span className="truncate">{t.name}</span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-line">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitGroup() }}
          placeholder="Nova grupa…"
          className="w-full px-2 py-1.5 text-sm rounded-md bg-field text-fg placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition"
        />
      </div>
    </div>
  )
}

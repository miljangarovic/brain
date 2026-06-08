import { useState } from 'react'
import type { Group } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ClaudeIcon, CodexIcon, GridIcon } from './icons'

type RenameKind = 'group' | 'feature' | 'terminal'

export function Sidebar(props: {
  groups: Group[]
  activeTerminalId: string | null
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  onSelectTerminal: (id: string) => void
  onToggleGroup: (id: string) => void
  onToggleFeature: (id: string) => void
  onAddGroup: () => void
  onAddFeature: (groupId: string, name: string) => void
  onAddTerminal: (featureId: string, name: string) => void
  onLaunchAgent: (featureId: string, kind: AgentKind) => void
  onToggleFeatureView: (featureId: string) => void
  onRenameGroup: (id: string, name: string) => void
  onRenameFeature: (id: string, name: string) => void
  onRenameTerminal: (id: string, name: string) => void
  onDeleteGroup: (id: string) => void
  onDeleteFeature: (id: string) => void
}) {
  const {
    groups, activeTerminalId, liveAgents, onSelectTerminal, onToggleGroup, onToggleFeature, onAddGroup,
    onAddFeature, onAddTerminal, onLaunchAgent, onToggleFeatureView,
    onRenameGroup, onRenameFeature, onRenameTerminal, onDeleteGroup, onDeleteFeature
  } = props

  const [editing, setEditing] = useState<{ kind: RenameKind; id: string } | null>(null)
  const [draft, setDraft] = useState('')
  const startRename = (kind: RenameKind, id: string, current: string) => { setEditing({ kind, id }); setDraft(current) }
  const commitRename = () => {
    if (!editing) return
    const name = draft.trim()
    if (name) {
      if (editing.kind === 'group') onRenameGroup(editing.id, name)
      else if (editing.kind === 'feature') onRenameFeature(editing.id, name)
      else onRenameTerminal(editing.id, name)
    }
    setEditing(null)
  }
  const isEditing = (kind: RenameKind, id: string) => editing?.kind === kind && editing.id === id
  const renameInput = (label: string) => (
    <input
      autoFocus aria-label={label} value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setEditing(null) }}
      className="flex-1 min-w-0 rounded bg-field px-1 text-sm text-fg-bright outline-none ring-1 ring-accent"
    />
  )

  const [featureDraft, setFeatureDraft] = useState<Record<string, string>>({})
  const [terminalDraft, setTerminalDraft] = useState<Record<string, string>>({})
  const submitFeature = (gid: string) => {
    const name = (featureDraft[gid] ?? '').trim()
    if (name) { onAddFeature(gid, name); setFeatureDraft((d) => ({ ...d, [gid]: '' })) }
  }
  const submitTerminal = (fid: string) => {
    const name = (terminalDraft[fid] ?? '').trim()
    if (name) { onAddTerminal(fid, name); setTerminalDraft((d) => ({ ...d, [fid]: '' })) }
  }

  const hoverBtn = 'opacity-0 group-hover:opacity-100 px-1 text-fg-muted transition'

  return (
    <div className="w-64 shrink-0 h-full flex flex-col bg-panel border-r border-line text-fg">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--od-accent)]" />
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-fg-muted">Terminaltor</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {groups.map((g) => (
          <div key={g.id} className="select-none">
            <div className="group flex items-center gap-1 px-2 py-1 hover:bg-hover">
              <button aria-label={`Skupi/raširi ${g.name}`} onClick={() => onToggleGroup(g.id)} className="w-4 text-fg-muted hover:text-fg">
                {g.collapsed ? '▸' : '▾'}
              </button>
              {isEditing('group', g.id) ? renameInput(`Preimenuj grupu ${g.name}`) : (
                <span className="flex-1 min-w-0 flex items-baseline gap-1.5 cursor-text" onDoubleClick={() => startRename('group', g.id, g.name)}>
                  <span className="truncate text-sm font-semibold text-fg-bright">{g.name}</span>
                  {g.cwd && <span className="truncate text-xs text-fg-muted/70">{g.cwd}</span>}
                </span>
              )}
              <button aria-label={`Obriši grupu ${g.name}`} onClick={() => onDeleteGroup(g.id)} className={`${hoverBtn} hover:text-danger`}>×</button>
            </div>

            {!g.collapsed && (
              <div className="pl-3">
                {g.features.map((f) => (
                  <div key={f.id}>
                    <div className="group flex items-center gap-1 px-2 py-1 hover:bg-hover">
                      <button aria-label={`Skupi/raširi feature ${f.name}`} onClick={() => onToggleFeature(f.id)} className="w-4 text-fg-muted hover:text-fg">
                        {f.collapsed ? '▸' : '▾'}
                      </button>
                      {isEditing('feature', f.id) ? renameInput(`Preimenuj feature ${f.name}`) : (
                        <span className="flex-1 truncate text-sm font-medium text-fg cursor-text" onDoubleClick={() => startRename('feature', f.id, f.name)}>{f.name}</span>
                      )}
                      <button aria-label={`Novi Claude terminal u ${f.name}`} title="Claude" onClick={() => onLaunchAgent(f.id, 'claude')} className={`${hoverBtn} text-base leading-none`}><ClaudeIcon /></button>
                      <button aria-label={`Novi Codex terminal u ${f.name}`} title="Codex" onClick={() => onLaunchAgent(f.id, 'codex')} className={`${hoverBtn} text-base leading-none`}><CodexIcon /></button>
                      <button aria-label={`Grid prikaz ${f.name}`} title="Grid" onClick={() => onToggleFeatureView(f.id)} className={`${hoverBtn} ${(f.viewMode ?? 'tabs') === 'grid' ? 'text-accent opacity-100' : ''}`}><GridIcon /></button>
                      <button aria-label={`Obriši feature ${f.name}`} onClick={() => onDeleteFeature(f.id)} className={`${hoverBtn} hover:text-danger`}>×</button>
                    </div>

                    {!f.collapsed && (
                      <div className="pl-2">
                        {f.terminals.map((t) => {
                          const active = t.id === activeTerminalId
                          return (
                            <div key={t.id} data-term-id={t.id} onClick={() => onSelectTerminal(t.id)}
                              className={`group flex items-center gap-2 pl-6 pr-2 py-1 text-sm cursor-pointer border-l-2 transition-colors ${
                                active ? 'border-accent bg-sel text-fg-bright' : 'border-transparent text-fg hover:bg-hover hover:text-fg-bright'}`}>
                              <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
                              {isEditing('terminal', t.id)
                                ? renameInput(`Preimenuj terminal ${t.name}`)
                                : <span className="truncate" onDoubleClick={(e) => { e.stopPropagation(); startRename('terminal', t.id, t.name) }}>{t.name}</span>}
                            </div>
                          )
                        })}
                        <input
                          aria-label={`Novi terminal u ${f.name}`} placeholder="+ terminal…"
                          value={terminalDraft[f.id] ?? ''}
                          onChange={(e) => setTerminalDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') submitTerminal(f.id) }}
                          className="ml-6 my-0.5 w-[calc(100%-1.75rem)] bg-transparent px-1 py-0.5 text-xs text-fg placeholder-fg-muted/60 outline-none focus:bg-field rounded"
                        />
                      </div>
                    )}
                  </div>
                ))}
                <input
                  aria-label={`Novi feature u ${g.name}`} placeholder="+ feature…"
                  value={featureDraft[g.id] ?? ''}
                  onChange={(e) => setFeatureDraft((d) => ({ ...d, [g.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitFeature(g.id) }}
                  className="ml-3 my-0.5 w-[calc(100%-1rem)] bg-transparent px-1 py-0.5 text-xs text-fg placeholder-fg-muted/60 outline-none focus:bg-field rounded"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-line">
        <button aria-label="Nova grupa" onClick={onAddGroup}
          className="w-full px-2 py-1.5 text-sm rounded-md bg-field text-fg-muted hover:text-accent outline-none transition">
          + Nova grupa
        </button>
      </div>
    </div>
  )
}

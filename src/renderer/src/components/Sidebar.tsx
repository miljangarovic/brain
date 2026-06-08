import { useRef, useState } from 'react'
import type { Group, ReviewStatus } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, GridIcon, TrashIcon, ReviewIcon } from './icons'
import { ContextMenu } from './ContextMenu'
import { AddMenuButton } from './AddMenuButton'
import { ReviewStatusDot } from './ReviewStatusDot'

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
  onAddTerminal: (featureId: string) => void
  onLaunchAgent: (featureId: string, kind: AgentKind) => void
  onToggleFeatureView: (featureId: string) => void
  onRenameGroup: (id: string, name: string) => void
  onRenameFeature: (id: string, name: string) => void
  onRenameTerminal: (id: string, name: string) => void
  onDeleteGroup: (id: string) => void
  onDeleteFeature: (id: string) => void
  onDeleteTerminal: (id: string) => void
  onOpenInFiles: (groupId: string) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
  onReviewTerminal: (terminalId: string, reviewer?: AgentKind) => void
}) {
  const {
    groups, activeTerminalId, liveAgents, onSelectTerminal, onToggleGroup, onToggleFeature, onAddGroup,
    onAddFeature, onAddTerminal, onLaunchAgent, onToggleFeatureView,
    onRenameGroup, onRenameFeature, onRenameTerminal, onDeleteGroup, onDeleteFeature, onDeleteTerminal, onOpenInFiles,
    reviewStatus, onReviewTerminal
  } = props

  const [menu, setMenu] = useState<{ x: number; y: number; groupId: string } | null>(null)
  const [termMenu, setTermMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null)
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

  // Single click on a group/feature name collapses it; double click renames.
  // A short timer disambiguates the two so a dblclick doesn't also fire collapse.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onNameClick = (collapse: () => void) => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => { clickTimer.current = null; collapse() }, 200)
  }
  const onNameDblClick = (rename: () => void) => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null }
    rename()
  }

  const [featureDraft, setFeatureDraft] = useState<Record<string, string>>({})
  const submitFeature = (gid: string) => {
    const name = (featureDraft[gid] ?? '').trim()
    if (name) { onAddFeature(gid, name); setFeatureDraft((d) => ({ ...d, [gid]: '' })) }
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
            <div className="group flex items-center gap-1 px-2 py-1 hover:bg-hover" onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, groupId: g.id }) }}>
              <button aria-label={`Skupi/raširi ${g.name}`} onClick={() => onToggleGroup(g.id)} className="w-4 text-fg-muted hover:text-fg">
                {g.collapsed ? '▸' : '▾'}
              </button>
              {isEditing('group', g.id) ? renameInput(`Preimenuj grupu ${g.name}`) : (
                <span className="flex-1 min-w-0 flex items-baseline gap-1.5 cursor-pointer"
                  onClick={() => onNameClick(() => onToggleGroup(g.id))}
                  onDoubleClick={() => onNameDblClick(() => startRename('group', g.id, g.name))}>
                  <span className="truncate text-sm font-semibold text-fg-bright">{g.name}</span>
                  {g.cwd && <span className="truncate text-xs text-fg-muted/70">{g.cwd}</span>}
                </span>
              )}
              <button aria-label={`Obriši grupu ${g.name}`} title="Obriši grupu" onClick={() => onDeleteGroup(g.id)} className={`${hoverBtn} text-base leading-none hover:text-danger`}><TrashIcon /></button>
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
                        <span className="flex-1 truncate text-sm font-medium text-fg cursor-pointer"
                          onClick={() => onNameClick(() => onToggleFeature(f.id))}
                          onDoubleClick={() => onNameDblClick(() => startRename('feature', f.id, f.name))}>{f.name}</span>
                      )}
                      <AddMenuButton
                        label={`Dodaj u ${f.name}`}
                        onAdd={(kind) => (kind === 'shell' ? onAddTerminal(f.id) : onLaunchAgent(f.id, kind))}
                        className={`${hoverBtn} text-base leading-none hover:text-accent`}
                      />
                      <button aria-label={`Grid prikaz ${f.name}`} title="Grid" onClick={() => onToggleFeatureView(f.id)} className={`${hoverBtn} ${(f.viewMode ?? 'tabs') === 'grid' ? 'text-accent opacity-100' : ''}`}><GridIcon /></button>
                      <button aria-label={`Obriši feature ${f.name}`} title="Obriši feature" onClick={() => onDeleteFeature(f.id)} className={`${hoverBtn} text-base leading-none hover:text-danger`}><TrashIcon /></button>
                    </div>

                    {!f.collapsed && (
                      <div className="pl-2">
                        {f.terminals.map((t) => {
                          const active = t.id === activeTerminalId
                          return (
                            <div key={t.id} data-term-id={t.id} onClick={() => onSelectTerminal(t.id)}
                              onContextMenu={(e) => { e.preventDefault(); setTermMenu({ x: e.clientX, y: e.clientY, terminalId: t.id }) }}
                              className={`group flex items-center gap-2 pl-6 pr-2 py-1 text-sm cursor-pointer border-l-2 transition-colors ${
                                active ? 'border-accent bg-sel text-fg-bright' : 'border-transparent text-fg hover:bg-hover hover:text-fg-bright'}`}>
                              <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
                              <ReviewStatusDot status={reviewStatus[t.id]} />
                              {isEditing('terminal', t.id)
                                ? renameInput(`Preimenuj terminal ${t.name}`)
                                : (
                                  <span className="flex-1 truncate"
                                    onDoubleClick={(e) => { e.stopPropagation(); startRename('terminal', t.id, t.name) }}>
                                    {t.name}
                                  </span>
                                )}
                              {!isEditing('terminal', t.id) && (
                                <>
                                  <button aria-label={`Review terminal ${t.name}`} title="Review"
                                    onClick={(e) => { e.stopPropagation(); onReviewTerminal(t.id) }}
                                    className={`${hoverBtn} text-base leading-none hover:text-accent`}><ReviewIcon /></button>
                                  <button aria-label={`Obriši terminal ${t.name}`} title="Obriši terminal"
                                    onClick={(e) => { e.stopPropagation(); onDeleteTerminal(t.id) }}
                                    className={`${hoverBtn} text-base leading-none hover:text-danger`}><TrashIcon /></button>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
                <div className="px-2 pt-1 pb-0.5">
                  <input
                    aria-label={`Novi feature u ${g.name}`} placeholder="+ Feature"
                    value={featureDraft[g.id] ?? ''}
                    onChange={(e) => setFeatureDraft((d) => ({ ...d, [g.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitFeature(g.id) }}
                    className="w-full px-2 py-1.5 text-sm rounded-md bg-field text-fg placeholder-fg-muted outline-none focus:ring-1 focus:ring-accent transition"
                  />
                </div>
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

      {menu && (() => {
        const g = groups.find((x) => x.id === menu.groupId)
        if (!g) return null
        return (
          <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
            { label: 'Preimenuj', onSelect: () => startRename('group', g.id, g.name) },
            { label: 'Open in Files', onSelect: () => onOpenInFiles(g.id) }
          ]} />
        )
      })()}

      {termMenu && (
        <ContextMenu x={termMenu.x} y={termMenu.y} onClose={() => setTermMenu(null)} items={[
          { label: 'Review ▸ Claude', onSelect: () => onReviewTerminal(termMenu.terminalId, 'claude') },
          { label: 'Review ▸ Codex', onSelect: () => onReviewTerminal(termMenu.terminalId, 'codex') }
        ]} />
      )}
    </div>
  )
}

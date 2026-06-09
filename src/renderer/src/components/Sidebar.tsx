import { useEffect, useRef, useState } from 'react'
import type { Group, ReviewStatus } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, GridIcon, TrashIcon, SpinnerIcon } from './icons'
import { ContextMenu } from './ContextMenu'
import { AddMenuButton } from './AddMenuButton'
import { ReviewStatusDot } from './ReviewStatusDot'
import { AttentionDot } from './AttentionDot'
import { AttentionBell, type AttentionBellItem } from './AttentionBell'
import type { AttentionState } from '../attention/detect'

type RenameKind = 'group' | 'feature' | 'terminal'

// A drag in progress: which kind of row, plus the container it reorders within
// (group → workspace, feature → its group, terminal → its feature). Cross-
// container moves are not allowed, mirroring the original feature reorder.
type Drag =
  | { kind: 'group'; id: string }
  | { kind: 'feature'; id: string; groupId: string }
  | { kind: 'terminal'; id: string; featureId: string }
type DropAt =
  | { kind: 'group'; index: number }
  | { kind: 'feature'; groupId: string; index: number }
  | { kind: 'terminal'; featureId: string; index: number }

// Insertion point (0..n) among rows with vertical midpoints `midpoints` for a
// cursor at `cursorY`: the first row the cursor sits above, else past the end.
// Cursor above the first row → 0 (becomes first); below the last → n (last).
export function insertionFromMidpoints(midpoints: number[], cursorY: number): number {
  const i = midpoints.findIndex((m) => cursorY < m)
  return i === -1 ? midpoints.length : i
}

// Convert an insertion point in the original array into the dragged item's final
// 0-based index, accounting for its removal from `fromIndex`.
export function reorderToIndex(insertion: number, fromIndex: number): number {
  return insertion > fromIndex ? insertion - 1 : insertion
}

// Vertical midpoints of the rows matching `selector` inside a drop container.
function rowMidpoints(container: Element, selector: string): number[] {
  return Array.from(container.querySelectorAll(selector)).map((el) => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2
  })
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 560
const SIDEBAR_DEFAULT = 256

// How long a single click on a group/feature name waits before collapsing, to
// give a double-click (rename) time to cancel it. Lower = snappier collapse, but
// too low and a slow double-click would collapse before the rename registers.
const NAME_CLICK_DELAY_MS = 100

export function Sidebar(props: {
  groups: Group[]
  activeTerminalId: string | null
  activeFeatureId: string | null
  activeGroupId: string | null
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  busy: Record<string, boolean>
  onSelectTerminal: (id: string) => void
  onToggleGroup: (id: string) => void
  onToggleFeature: (id: string) => void
  onAddGroup: () => void
  onAddFeature: (groupId: string, name: string) => void
  onAddTerminal: (featureId: string) => void
  onLaunchAgent: (featureId: string, kind: AgentKind) => void
  onToggleFeatureView: (featureId: string) => void
  onMoveGroup: (groupId: string, toIndex: number) => void
  onMoveFeature: (featureId: string, toIndex: number) => void
  onMoveTerminal: (terminalId: string, toIndex: number) => void
  onRenameGroup: (id: string, name: string) => void
  onRenameFeature: (id: string, name: string) => void
  onRenameTerminal: (id: string, name: string) => void
  onDeleteGroup: (id: string) => void
  onDeleteFeature: (id: string) => void
  onDeleteTerminal: (id: string) => void
  onOpenInFiles: (groupId: string) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
  onReviewTerminal: (terminalId: string, reviewer?: AgentKind) => void
  pendingRenameTerminalId?: string | null
  onPendingRenameConsumed?: () => void
  attention: Record<string, AttentionState | undefined>
  attentionItems: AttentionBellItem[]
  attentionMuted: boolean
  onAttentionSelect: (terminalId: string) => void
  onAttentionClear: (terminalId: string) => void
  onAttentionClearAll: () => void
  onToggleAttentionMute: () => void
}) {
  const {
    groups, activeTerminalId, activeFeatureId, activeGroupId, liveAgents, busy, onSelectTerminal, onToggleGroup, onToggleFeature, onAddGroup,
    onAddFeature, onAddTerminal, onLaunchAgent, onToggleFeatureView, onMoveGroup, onMoveFeature, onMoveTerminal,
    onRenameGroup, onRenameFeature, onRenameTerminal, onDeleteGroup, onDeleteFeature, onDeleteTerminal, onOpenInFiles,
    reviewStatus, onReviewTerminal, pendingRenameTerminalId, onPendingRenameConsumed,
    attention, attentionItems, attentionMuted, onAttentionSelect, onAttentionClear, onAttentionClearAll, onToggleAttentionMute
  } = props

  const [menu, setMenu] = useState<{ x: number; y: number; groupId: string } | null>(null)
  const [termMenu, setTermMenu] = useState<{ x: number; y: number; terminalId: string } | null>(null)

  // Drag-and-drop reorder for projects, features, and terminals — each within its
  // own container only. The whole row is draggable. The active drag lives in a ref
  // (read synchronously in dragover/drop so `preventDefault` is never skipped by a
  // stale closure — that is what makes the drop reliably accepted). `drag`/`dropAt`
  // are state only for the visuals (dimming the dragged row, the insertion-line
  // indicator). Drop zones nest (groups ⊃ features ⊃ terminals), so a handler
  // ignores any drag of a different kind and lets the matching zone own it; only
  // the matching zone clears the drag, otherwise onDragEnd does. A plain click /
  // double-click still selects/collapses/renames (HTML5 drag starts only on move).
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropAt, setDropAt] = useState<DropAt | null>(null)
  const clearDrag = () => { dragRef.current = null; setDrag(null); setDropAt(null) }

  // Resizable width, persisted across reloads. Dragging the right-edge handle
  // sets the width to the cursor's x (the sidebar is flush against the left edge).
  const [width, setWidth] = useState(() => {
    const saved = Number((typeof localStorage !== 'undefined' && localStorage.getItem('sidebarWidth')) || '')
    return saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT
  })
  useEffect(() => { try { localStorage.setItem('sidebarWidth', String(width)) } catch { /* ignore */ } }, [width])
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => setWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX)))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

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
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setEditing(null) }}
      className="flex-1 min-w-0 rounded bg-field px-1 text-sm text-fg-bright outline-none ring-1 ring-accent"
    />
  )

  // A freshly-added terminal asks (via prop) to immediately open its rename input,
  // so the user can name it right away instead of living with the default 'shell'.
  useEffect(() => {
    if (!pendingRenameTerminalId) return
    const t = groups.flatMap((g) => g.features).flatMap((f) => f.terminals).find((t) => t.id === pendingRenameTerminalId)
    if (t) {
      startRename('terminal', t.id, t.name)
      onPendingRenameConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRenameTerminalId])

  // Single click on a group/feature name collapses it; double click renames.
  // A short timer disambiguates the two so a dblclick doesn't also fire collapse.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onNameClick = (collapse: () => void) => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => { clickTimer.current = null; collapse() }, NAME_CLICK_DELAY_MS)
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
    <div style={{ width }} className="relative shrink-0 h-full flex flex-col bg-panel border-r border-line text-fg">
      <div className="p-2 border-b border-line">
        <AttentionBell
          items={attentionItems}
          muted={attentionMuted}
          onSelect={onAttentionSelect}
          onClear={onAttentionClear}
          onClearAll={onAttentionClearAll}
          onToggleMute={onToggleAttentionMute}
        />
      </div>
      <div
        className="flex-1 overflow-y-auto py-1"
        data-groups
        onDragOver={(e) => {
          const d = dragRef.current
          if (!d || d.kind !== 'group') return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          setDropAt({ kind: 'group', index: insertionFromMidpoints(rowMidpoints(e.currentTarget, '[data-group-id]'), e.clientY) })
        }}
        onDrop={(e) => {
          const d = dragRef.current
          if (!d || d.kind !== 'group') return
          e.preventDefault()
          const from = groups.findIndex((x) => x.id === d.id)
          const to = reorderToIndex(insertionFromMidpoints(rowMidpoints(e.currentTarget, '[data-group-id]'), e.clientY), from)
          if (to !== from) onMoveGroup(d.id, to)
          clearDrag()
        }}
      >
        {groups.map((g, gi) => {
          const groupActive = g.id === activeGroupId
          return (
          <div key={g.id} className="select-none">
            <div
              data-group-id={g.id}
              aria-current={groupActive ? 'true' : undefined}
              className={`relative group flex items-center gap-1 px-2 py-1 transition-colors ${groupActive ? 'bg-accent-soft' : 'hover:bg-hover'} ${drag?.kind === 'group' && drag.id === g.id ? 'opacity-40' : ''} ${!isEditing('group', g.id) ? 'cursor-grab active:cursor-grabbing' : ''}`}
              draggable={!isEditing('group', g.id)}
              onDragStart={(e) => { if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; dragRef.current = { kind: 'group', id: g.id }; setDrag({ kind: 'group', id: g.id }) }}
              onDragEnd={clearDrag}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, groupId: g.id }) }}
            >
              {groupActive && (
                <div className="pointer-events-none absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-accent" />
              )}
              {dropAt?.kind === 'group' && dropAt.index === gi && (
                <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-accent" />
              )}
              {dropAt?.kind === 'group' && dropAt.index === groups.length && gi === groups.length - 1 && (
                <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />
              )}
              <button aria-label={`Collapse/expand ${g.name}`} onClick={() => onToggleGroup(g.id)} className={`w-4 hover:text-fg ${groupActive ? 'text-accent' : 'text-fg-muted'}`}>
                {g.collapsed ? '▸' : '▾'}
              </button>
              {isEditing('group', g.id) ? renameInput(`Rename project ${g.name}`) : (
                <span className="flex-1 min-w-0 truncate text-sm font-semibold text-fg-bright cursor-pointer"
                  onClick={() => onNameClick(() => onToggleGroup(g.id))}
                  onDoubleClick={() => onNameDblClick(() => startRename('group', g.id, g.name))}>{g.name}</span>
              )}
              <button aria-label={`Delete project ${g.name}`} title="Delete project" onClick={() => onDeleteGroup(g.id)} className={`${hoverBtn} text-base leading-none hover:text-danger`}><TrashIcon /></button>
            </div>

            {!g.collapsed && (
              <div
                className="pl-3"
                data-group-features={g.id}
                onDragOver={(e) => {
                  const d = dragRef.current
                  if (!d || d.kind !== 'feature') return                // not a feature drag — let the matching zone own it
                  if (d.groupId !== g.id) { setDropAt(null); return }    // hovering another project — clear stale line
                  e.preventDefault()
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  setDropAt({ kind: 'feature', groupId: g.id, index: insertionFromMidpoints(rowMidpoints(e.currentTarget, '[data-feature-id]'), e.clientY) })
                }}
                onDrop={(e) => {
                  const d = dragRef.current
                  if (!d || d.kind !== 'feature' || d.groupId !== g.id) return
                  e.preventDefault()
                  const from = g.features.findIndex((x) => x.id === d.id)
                  const to = reorderToIndex(insertionFromMidpoints(rowMidpoints(e.currentTarget, '[data-feature-id]'), e.clientY), from)
                  if (to !== from) onMoveFeature(d.id, to)
                  clearDrag()
                }}
              >
                {g.features.map((f, i) => {
                  const featureActive = f.id === activeFeatureId
                  return (
                  <div key={f.id}>
                    <div
                      data-feature-id={f.id}
                      aria-current={featureActive ? 'true' : undefined}
                      className={`relative group flex items-center gap-1 px-2 py-1 transition-colors ${featureActive ? 'bg-accent-soft' : 'hover:bg-hover'} ${drag?.kind === 'feature' && drag.id === f.id ? 'opacity-40' : ''} ${!isEditing('feature', f.id) ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      draggable={!isEditing('feature', f.id)}
                      onDragStart={(e) => { if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; dragRef.current = { kind: 'feature', id: f.id, groupId: g.id }; setDrag({ kind: 'feature', id: f.id, groupId: g.id }) }}
                      onDragEnd={clearDrag}
                    >
                      {featureActive && (
                        <div className="pointer-events-none absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-accent" />
                      )}
                      {dropAt?.kind === 'feature' && dropAt.groupId === g.id && dropAt.index === i && (
                        <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-accent" />
                      )}
                      {dropAt?.kind === 'feature' && dropAt.groupId === g.id && dropAt.index === g.features.length && i === g.features.length - 1 && (
                        <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />
                      )}
                      <button aria-label={`Collapse/expand feature ${f.name}`} onClick={() => onToggleFeature(f.id)} className={`w-4 hover:text-fg ${featureActive ? 'text-accent' : 'text-fg-muted'}`}>
                        {f.collapsed ? '▸' : '▾'}
                      </button>
                      {isEditing('feature', f.id) ? renameInput(`Rename feature ${f.name}`) : (
                        <span className={`flex-1 truncate text-sm font-medium cursor-pointer ${featureActive ? 'text-fg-bright' : 'text-fg'}`}
                          onClick={() => onNameClick(() => onToggleFeature(f.id))}
                          onDoubleClick={() => onNameDblClick(() => startRename('feature', f.id, f.name))}>{f.name}</span>
                      )}
                      {f.terminals.some((t) => busy[t.id] && liveAgents[t.id]) && <SpinnerIcon className="shrink-0 text-accent" />}
                      <AddMenuButton
                        label={`Add to ${f.name}`}
                        onAdd={(kind) => (kind === 'shell' ? onAddTerminal(f.id) : onLaunchAgent(f.id, kind))}
                        className={`${hoverBtn} text-base leading-none hover:text-accent`}
                      />
                      <button aria-label={`Grid view ${f.name}`} title="Grid" onClick={() => onToggleFeatureView(f.id)} className={`${hoverBtn} ${(f.viewMode ?? 'tabs') === 'grid' ? 'text-accent opacity-100' : ''}`}><GridIcon /></button>
                      <button aria-label={`Delete feature ${f.name}`} title="Delete feature" onClick={() => onDeleteFeature(f.id)} className={`${hoverBtn} text-base leading-none hover:text-danger`}><TrashIcon /></button>
                    </div>

                    {!f.collapsed && (
                      <div
                        className="pl-2"
                        data-feature-terminals={f.id}
                        onDragOver={(e) => {
                          const d = dragRef.current
                          if (!d || d.kind !== 'terminal') return       // not a terminal drag — let the matching zone own it
                          if (d.featureId !== f.id) { setDropAt(null); return }   // a different feature — no cross-feature move
                          e.preventDefault()
                          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                          setDropAt({ kind: 'terminal', featureId: f.id, index: insertionFromMidpoints(rowMidpoints(e.currentTarget, '[data-term-id]'), e.clientY) })
                        }}
                        onDrop={(e) => {
                          const d = dragRef.current
                          if (!d || d.kind !== 'terminal' || d.featureId !== f.id) return
                          e.preventDefault()
                          const from = f.terminals.findIndex((x) => x.id === d.id)
                          const to = reorderToIndex(insertionFromMidpoints(rowMidpoints(e.currentTarget, '[data-term-id]'), e.clientY), from)
                          if (to !== from) onMoveTerminal(d.id, to)
                          clearDrag()
                        }}
                      >
                        {f.terminals.map((t, ti) => {
                          const active = t.id === activeTerminalId
                          return (
                            <div key={t.id} data-term-id={t.id} onClick={() => onSelectTerminal(t.id)}
                              onContextMenu={(e) => { e.preventDefault(); setTermMenu({ x: e.clientX, y: e.clientY, terminalId: t.id }) }}
                              draggable={!isEditing('terminal', t.id)}
                              onDragStart={(e) => { e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; dragRef.current = { kind: 'terminal', id: t.id, featureId: f.id }; setDrag({ kind: 'terminal', id: t.id, featureId: f.id }) }}
                              onDragEnd={clearDrag}
                              className={`relative group flex items-center gap-2 pl-6 pr-2 py-1 text-sm cursor-pointer border-l-2 transition-colors ${drag?.kind === 'terminal' && drag.id === t.id ? 'opacity-40' : ''} ${
                                active ? 'border-accent bg-accent-sel text-fg-bright' : 'border-transparent text-fg hover:bg-hover hover:text-fg-bright'}`}>
                              {dropAt?.kind === 'terminal' && dropAt.featureId === f.id && dropAt.index === ti && (
                                <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-accent" />
                              )}
                              {dropAt?.kind === 'terminal' && dropAt.featureId === f.id && dropAt.index === f.terminals.length && ti === f.terminals.length - 1 && (
                                <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />
                              )}
                              {busy[t.id] && liveAgents[t.id]
                                ? <SpinnerIcon className="shrink-0 text-accent" />
                                : <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />}
                              <ReviewStatusDot status={reviewStatus[t.id]} />
                              <AttentionDot state={attention[t.id]} />
                              {isEditing('terminal', t.id)
                                ? renameInput(`Rename terminal ${t.name}`)
                                : (
                                  <span className="flex-1 truncate"
                                    onDoubleClick={(e) => { e.stopPropagation(); startRename('terminal', t.id, t.name) }}>
                                    {t.name}
                                  </span>
                                )}
                              {!isEditing('terminal', t.id) && (
                                <button aria-label={`Delete terminal ${t.name}`} title="Delete terminal"
                                  onClick={(e) => { e.stopPropagation(); onDeleteTerminal(t.id) }}
                                  className={`${hoverBtn} text-base leading-none hover:text-danger`}><TrashIcon /></button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  )
                })}
                <div className="px-2 pt-1 pb-0.5">
                  <input
                    aria-label={`New feature in ${g.name}`} placeholder="+ Feature"
                    value={featureDraft[g.id] ?? ''}
                    onChange={(e) => setFeatureDraft((d) => ({ ...d, [g.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitFeature(g.id) }}
                    className="w-full px-2 py-1.5 text-sm rounded-md bg-field text-fg placeholder-fg-muted outline-none focus:ring-1 focus:ring-accent transition"
                  />
                </div>
              </div>
            )}
          </div>
          )
        })}
      </div>

      <div className="p-2 border-t border-line">
        <button aria-label="New Project" onClick={onAddGroup}
          className="w-full px-2 py-1.5 text-sm rounded-md bg-field text-fg-muted hover:text-accent outline-none transition">
          + New Project
        </button>
      </div>

      {menu && (() => {
        const g = groups.find((x) => x.id === menu.groupId)
        if (!g) return null
        return (
          <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
            { label: 'Rename', onSelect: () => startRename('group', g.id, g.name) },
            { label: 'Open in Files', onSelect: () => onOpenInFiles(g.id) }
          ]} />
        )
      })()}

      {termMenu && (
        <ContextMenu x={termMenu.x} y={termMenu.y} onClose={() => setTermMenu(null)} items={[
          { label: 'Review', onSelect: () => onReviewTerminal(termMenu.terminalId, 'codex') },
          { label: 'Delete', onSelect: () => onDeleteTerminal(termMenu.terminalId) }
        ]} />
      )}

      <div
        role="separator" aria-label="Resize sidebar"
        onMouseDown={startResize}
        className="absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent/60"
      />
    </div>
  )
}

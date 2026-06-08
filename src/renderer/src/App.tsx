// src/renderer/src/App.tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from './useStore'
import { removedIds } from './ptyReaper'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode,
  addTerminal, renameTerminal, removeTerminal, hideTerminal, showTerminal, isHidden,
  setActiveTerminal, setActiveFeature,
  getActiveGroup, getActiveFeature, getActiveTerminal, getTerminalById, findReviewerFor, allTerminals
} from './store'
import { migrateWorkspace } from './migrate'
import { AGENTS, detectAgent, type AgentKind } from './agents'
import type { ReviewStatus } from '@shared/types'
import { useReview } from './review/useReview'
import { gridDimensions } from './layout'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { FeatureHeader } from './components/FeatureHeader'
import { TerminalView } from './components/TerminalView'
import { NewGroupDialog, NewGroupInput } from './components/NewGroupDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ReviewDialog, type ReviewStartArgs } from './components/ReviewDialog'

export default function App() {
  const { state, setState, apply } = useStore()
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null)
  const askDelete = (message: string, action: () => void) => setConfirm({ message, action })
  const [liveAgents, setLiveAgents] = useState<Record<string, AgentKind | undefined>>({})
  useEffect(() => {
    return window.terminaltor.onPtyProc((id, process) => {
      setLiveAgents((m) => ({ ...m, [id]: detectAgent(process) ?? undefined }))
    })
  }, [])

  // Live "is producing output" flag per terminal — drives the busy spinner in
  // the tab bar and sidebar. Main emits only on idle↔busy transitions.
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  useEffect(() => {
    return window.terminaltor.onPtyBusy((id, b) => setBusy((m) => ({ ...m, [id]: b })))
  }, [])

  const [reviewStatus, setReviewStatus] = useState<Record<string, ReviewStatus | undefined>>({})
  const [reviewReq, setReviewReq] = useState<{ id: string; reviewer?: AgentKind } | null>(null)
  const setStatus = useCallback(
    (id: string, status: ReviewStatus | undefined) => setReviewStatus((m) => ({ ...m, [id]: status })),
    []
  )
  const review = useReview(state, apply, setStatus)
  useEffect(() => window.terminaltor.onFsChanged(review.handleFsChanged), [review.handleFsChanged])

  useEffect(() => {
    window.terminaltor.loadWorkspace().then((ws) => {
      setState(createInitialState(migrateWorkspace(ws)))
      setLoaded(true)
    })
  }, [setState])

  useEffect(() => {
    if (!loaded) return
    window.terminaltor.saveWorkspace(state.workspace)
  }, [state.workspace, loaded])

  // Kill a terminal's PTY only when it actually leaves the workspace (delete
  // terminal/feature/group) — NOT when its TerminalView unmounts, which also
  // happens on HMR/Fast Refresh remounts and must not disturb the running shell.
  const prevTermIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(allTerminals(state).map((t) => t.id))
    if (prevTermIds.current) {
      for (const id of removedIds(prevTermIds.current, ids)) window.terminaltor.killPty(id)
    }
    prevTermIds.current = ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspace])

  const activeGroup = getActiveGroup(state)
  const activeFeature = getActiveFeature(state)

  const activeTerminal = getActiveTerminal(state)
  const activeStatus = activeTerminal ? reviewStatus[activeTerminal.id] : undefined
  const activeIsReviewer = !!activeTerminal?.review
  const activeIsOrigin = activeTerminal ? findReviewerFor(state, activeTerminal.id) !== null : false
  const relayFlags = {
    canReturn: activeIsReviewer && activeStatus === 'review-ready',
    canReReview: activeIsOrigin && activeStatus === 'iteration-done',
    canMarkApplied: activeIsOrigin && activeStatus === 'applying'
  }
  const startReview = (args: ReviewStartArgs) => {
    if (!reviewReq) return
    void review.startReview({ originTerminalId: reviewReq.id, ...args })
    setReviewReq(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') {           // hide active terminal (shell keeps running)
        e.preventDefault()
        if (state.activeTerminalId) apply((s) => hideTerminal(s, state.activeTerminalId!))
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault()
        if (state.activeFeatureId) apply((s) => toggleFeatureViewMode(s, state.activeFeatureId!))
      } else if (e.ctrlKey && e.code === 'PageDown') {
        e.preventDefault(); cycleTab(1)
      } else if (e.ctrlKey && e.code === 'PageUp') {
        e.preventDefault(); cycleTab(-1)
      }
    }
    const cycleTab = (dir: number) => {
      const f = getActiveFeature(state)
      const visible = f?.terminals.filter((t) => !state.hidden.includes(t.id)) ?? []
      if (visible.length === 0) return
      const idx = visible.findIndex((t) => t.id === state.activeTerminalId)
      const next = visible[(idx + dir + visible.length) % visible.length]
      apply((s) => setActiveTerminal(s, next.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, apply])

  const launchAgent = (featureId: string, kind: AgentKind) => {
    const a = AGENTS[kind]
    apply((s) => addTerminal(s, featureId, { name: a.defaultName, startupCommand: a.command, kind }))
  }
  const createGroup = (input: NewGroupInput) => {
    apply((s) => addGroup(s, input.name, input.cwd))
    setGroupDialogOpen(false)
  }

  // ALL terminals stay mounted so their shells keep running; hidden ones are just
  // omitted from the tab bar / grid (mounted but display:none).
  const terminals = allTerminals(state)
  const featureVisible = (activeFeature?.terminals ?? []).filter((t) => !state.hidden.includes(t.id))
  const gridMode = (activeFeature?.viewMode ?? 'tabs') === 'grid'
  const featureTerminalIds = new Set(featureVisible.map((t) => t.id))
  const { cols, rows } = gridDimensions(featureVisible.length)

  return (
    <div className="flex h-screen text-fg bg-panel">
      <Sidebar
        groups={state.workspace.groups}
        activeTerminalId={state.activeTerminalId}
        liveAgents={liveAgents}
        busy={busy}
        onSelectTerminal={(id) => apply((s) => (isHidden(s, id) ? showTerminal(s, id) : setActiveTerminal(s, id)))}
        onToggleGroup={(id) => apply((s) => toggleGroupCollapsed(s, id))}
        onToggleFeature={(id) => apply((s) => toggleFeatureCollapsed(s, id))}
        onAddGroup={() => setGroupDialogOpen(true)}
        onAddFeature={(gid, name) => apply((s) => addFeature(s, gid, name))}
        onAddTerminal={(fid) => apply((s) => addTerminal(s, fid, { name: 'shell' }))}
        onLaunchAgent={launchAgent}
        onToggleFeatureView={(fid) => apply((s) => toggleFeatureViewMode(setActiveFeature(s, fid), fid))}
        onRenameGroup={(id, name) => apply((s) => renameGroup(s, id, name))}
        onRenameFeature={(id, name) => apply((s) => renameFeature(s, id, name))}
        onRenameTerminal={(id, name) => apply((s) => renameTerminal(s, id, name))}
        onDeleteGroup={(id) => {
          const g = state.workspace.groups.find((x) => x.id === id)
          askDelete(`Obrisati grupu "${g?.name ?? ''}"? Svi feature-i i terminali u njoj se zatvaraju.`, () => apply((s) => deleteGroup(s, id)))
        }}
        onDeleteFeature={(id) => {
          const f = state.workspace.groups.flatMap((g) => g.features).find((x) => x.id === id)
          askDelete(`Obrisati feature "${f?.name ?? ''}"? Terminali u njemu se zatvaraju.`, () => apply((s) => deleteFeature(s, id)))
        }}
        onDeleteTerminal={(id) => {
          const t = allTerminals(state).find((x) => x.id === id)
          askDelete(`Obrisati terminal "${t?.name ?? ''}"?`, () => apply((s) => removeTerminal(s, id)))
        }}
        onOpenInFiles={(gid) => {
          const g = state.workspace.groups.find((x) => x.id === gid)
          window.terminaltor.openPath(g?.cwd ?? '')
        }}
        reviewStatus={reviewStatus}
        onReviewTerminal={(id, reviewer) => setReviewReq({ id, reviewer })}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {activeFeature && (
          <FeatureHeader
            featureName={activeFeature.name}
            viewMode={activeFeature.viewMode ?? 'tabs'}
            onToggleView={() => apply((s) => toggleFeatureViewMode(s, activeFeature.id))}
            onAdd={(kind) => (kind === 'shell'
              ? apply((s) => addTerminal(s, activeFeature.id, { name: 'shell' }))
              : launchAgent(activeFeature.id, kind))}
            relay={relayFlags}
            onReturnToOrigin={() => { if (activeTerminal) void review.relayToOrigin(activeTerminal.id) }}
            onReReview={() => { if (activeTerminal) void review.reReview(activeTerminal.id) }}
            onMarkApplied={() => { if (activeTerminal) review.markApplied(activeTerminal.id) }}
          />
        )}
        <TabBar
          terminals={featureVisible}
          activeId={state.activeTerminalId}
          liveAgents={liveAgents}
          busy={busy}
          onSelect={(id) => apply((s) => setActiveTerminal(s, id))}
          onClose={(id) => apply((s) => hideTerminal(s, id))}
          reviewStatus={reviewStatus}
          onReviewTerminal={(id, reviewer) => setReviewReq({ id, reviewer })}
        />

        <div
          className={`relative flex-1 min-h-0 bg-surface ${gridMode ? 'grid gap-px bg-line' : ''}`}
          style={gridMode ? { gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0,1fr))` } : undefined}
        >
          {featureVisible.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg-muted">
              <span className="text-2xl font-semibold tracking-tight text-fg">Terminaltor</span>
              <span className="text-sm">{activeGroup ? 'Dodaj terminal ili ga otvori iz sidebar-a.' : 'Napravi grupu da počneš.'}</span>
            </div>
          )}
          {terminals.map((t) => {
            const inFeature = featureTerminalIds.has(t.id)
            const isActive = t.id === state.activeTerminalId
            if (gridMode && inFeature) {
              return (
                <div key={t.id} onMouseDown={() => apply((s) => setActiveTerminal(s, t.id))}
                  className={`relative min-h-0 min-w-0 bg-surface border ${isActive ? 'border-accent' : 'border-transparent'}`}>
                  <TerminalView terminal={t} active={isActive} />
                </div>
              )
            }
            const visible = inFeature && !gridMode && isActive
            return (
              <div key={t.id} className="absolute inset-0" style={{ display: visible ? 'block' : 'none' }}>
                <TerminalView terminal={t} active={isActive} />
              </div>
            )
          })}
        </div>
      </div>

      {groupDialogOpen && <NewGroupDialog onCreate={createGroup} onCancel={() => setGroupDialogOpen(false)} />}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={() => { confirm.action(); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {reviewReq && (() => {
        const origin = getTerminalById(state, reviewReq.id)
        if (!origin) return null
        const currentKind = liveAgents[origin.id] ?? origin.kind
        const defaultReviewer: AgentKind = reviewReq.reviewer ?? (currentKind === 'claude' ? 'codex' : 'claude')
        const group = state.workspace.groups.find((g) => g.features.some((f) => f.terminals.some((t) => t.id === origin.id)))
        return (
          <ReviewDialog
            originName={origin.name}
            defaultReviewer={defaultReviewer}
            cwd={group?.cwd ?? ''}
            onStart={startReview}
            onCancel={() => setReviewReq(null)}
          />
        )
      })()}
    </div>
  )
}

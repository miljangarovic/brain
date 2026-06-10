// src/renderer/src/App.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useStore } from './useStore'
import { removedIds, pruneRecord } from './ptyReaper'
import { shouldSpawn, restoredSpawnIds } from './spawnGate'
import { isLayoutRepaint } from './repaintGuard'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed, moveGroup,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode, setFeatureGridStyle, moveFeature,
  addTerminal, renameTerminal, removeTerminal, hideTerminal, showTerminal, moveTerminal,
  setActiveTerminal, setActiveFeature, setTerminalSessionId,
  getActiveGroup, getActiveFeature, getActiveTerminal, getTerminalById, allTerminals, terminalPath, isUnderReview,
  addImportedGroup, addImportedFeature,
  archiveFeature, restoreFeature, deleteArchivedFeature, addDocument, renameDocument, removeDocument
} from './store'
import { collectCwdCandidates, buildImport } from './importRemap'
import { ExportToast } from './components/ExportToast'
import type { ExportProgress, ExportRunResult } from '@shared/exportTypes'
import { useAttention } from './attention/useAttention'
import { migrateWorkspace } from './migrate'
import { createId } from '@shared/id'
import { AGENTS, detectAgent, agentLaunchCommand, type AgentKind } from './agents'
import type { ReviewStatus } from '@shared/types'
import { useReview } from './review/useReview'
import { styledGridLayout } from './layout'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { FeatureHeader } from './components/FeatureHeader'
import { TerminalPane } from './components/TerminalPane'
import { NewGroupDialog, NewGroupInput } from './components/NewGroupDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ReviewDialog, type ReviewStartArgs } from './components/ReviewDialog'
import { ArchiveDialog } from './components/ArchiveDialog'

export default function App() {
  const { state, setState, apply } = useStore()
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [archiveGroupId, setArchiveGroupId] = useState<string | null>(null)
  const archiveGroup = archiveGroupId
    ? state.workspace.groups.find((g) => g.id === archiveGroupId) ?? null
    : null
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null)
  const askDelete = (message: string, action: () => void) => setConfirm({ message, action })
  // Id of a just-added shell terminal whose rename input the sidebar should auto-open.
  const [renameTerminalId, setRenameTerminalId] = useState<string | null>(null)
  const addShellTerminal = (featureId: string) => {
    const id = createId()
    apply((s) => addTerminal(s, featureId, { name: 'shell', id }))
    setRenameTerminalId(id)
  }

  // Restore = the app-restart rules for this feature's terminals: cold until
  // opened, agents resume. Refs are mutated BEFORE apply() so the remount sees
  // them; a pre-archive "started" flag must not auto-launch anything either.
  const restoreArchivedFeature = (featureId: string) => {
    const f = archiveGroup?.archivedFeatures?.find((x) => x.id === featureId)
    if (!f) return
    const { bootIds, resumeIds } = restoredSpawnIds(f)
    for (const id of bootIds) bootIdsRef.current.add(id)
    for (const id of resumeIds) resumeIdsRef.current.add(id)
    setStartedIds((prev) => {
      const next = new Set(prev)
      for (const id of bootIds) next.delete(id)
      return next
    })
    apply((s) => restoreFeature(s, featureId))
  }

  // Id of a just-added document whose rename input the sidebar should auto-open.
  const [renameDocId, setRenameDocId] = useState<string | null>(null)
  const addDocumentTo = async (featureId: string) => {
    const group = state.workspace.groups.find((g) => g.features.some((f) => f.id === featureId))
    const feature = group?.features.find((f) => f.id === featureId)
    const path = await window.brain.pickFile(group?.cwd ? { defaultPath: group.cwd } : undefined)
    if (!path) return
    if (feature?.documents?.some((d) => d.path === path)) return // already referenced: no-op
    const id = createId()
    apply((s) => addDocument(s, featureId, { id, name: path.split('/').pop() || path, path }))
    setRenameDocId(id)
  }
  // Drag-and-drop reorder of terminals inside the open grid. The pane header is the
  // drag handle; dropping a pane onto another moves it into that pane's slot. The
  // dragged id lives in a ref so dragover/drop read it synchronously (a stale
  // closure must never skip preventDefault, or the drop is silently rejected); the
  // two state ids only drive visuals (dim the dragged pane, ring the drop target).
  const gridDragRef = useRef<string | null>(null)
  const [gridDragId, setGridDragId] = useState<string | null>(null)
  const [gridDropId, setGridDropId] = useState<string | null>(null)
  const clearGridDrag = () => { gridDragRef.current = null; setGridDragId(null); setGridDropId(null) }

  // Export/import feedback: live progress while the main process summarizes
  // sessions, then a dismissible result notice (shared with import results).
  // `transferRef` guards against double-triggering an export/import AND drops
  // any progress event that straggles in after the invoke already resolved —
  // without it a late event would re-show the spinner forever.
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [exportNotice, setExportNotice] = useState<{ text: string; path?: string } | null>(null)
  const transferRef = useRef(false)
  useEffect(() => window.brain.onExportProgress((p) => { if (transferRef.current) setExportProgress(p) }), [])

  const [liveAgents, setLiveAgents] = useState<Record<string, AgentKind | undefined>>({})
  useEffect(() => {
    return window.brain.onPtyProc((id, process) => {
      setLiveAgents((m) => ({ ...m, [id]: detectAgent(process) ?? undefined }))
    })
  }, [])

  const [reviewStatus, setReviewStatus] = useState<Record<string, ReviewStatus | undefined>>({})

  // Grid toggles / style switches resize every pane and make the TUIs repaint;
  // busy=true transitions inside the short window after such an action are
  // repaint noise, not work — drop them before any busy consumer sees them.
  const layoutChangeAt = useRef(0)
  const markLayoutChange = useCallback(() => { layoutChangeAt.current = Date.now() }, [])
  const guardBusy = useCallback(
    (handler: (id: string, busy: boolean) => void) =>
      (id: string, b: boolean) => {
        if (isLayoutRepaint(b, Date.now(), layoutChangeAt.current)) return
        handler(id, b)
      },
    []
  )

  // Live "is producing output" flag per terminal — drives the busy spinner in the
  // tab bar and sidebar. Main emits only on idle↔busy transitions. A terminal going
  // busy also clears its green 'approved' review dot — its next request has started.
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  useEffect(() => {
    return window.brain.onPtyBusy(guardBusy((id, b) => {
      setBusy((m) => ({ ...m, [id]: b }))
      if (b) setReviewStatus((m) => (m[id] === 'approved' ? { ...m, [id]: undefined } : m))
    }))
  }, [guardBusy])

  const [reviewReq, setReviewReq] = useState<{ id: string; reviewer?: AgentKind } | null>(null)
  const setStatus = useCallback(
    (id: string, status: ReviewStatus | undefined) => setReviewStatus((m) => ({ ...m, [id]: status })),
    []
  )
  const review = useReview(state, apply, setStatus, reviewStatus)
  useEffect(() => window.brain.onFsChanged(review.handleFsChanged), [review.handleFsChanged])
  useEffect(() => window.brain.onPtyBusy(guardBusy(review.handleBusy)), [review.handleBusy, guardBusy])

  const attention = useAttention(state, apply)
  useEffect(() => window.brain.onPtyBusy(guardBusy(attention.handleBusy)), [attention.handleBusy, guardBusy])
  useEffect(() => window.brain.onPtyExit(attention.handleExit), [attention.handleExit])
  useEffect(() => window.brain.onNotificationClick(attention.handleNotificationClick), [attention.handleNotificationClick])

  // Agent terminals present at first load are "restored" — their PTYs should
  // spawn with the agent's resume command so the previous session continues
  // instead of starting fresh. Terminals created later in the session are not in
  // this set, so they launch normally. Held in a ref (it never changes after the
  // initial load and must not trigger re-renders).
  const resumeIdsRef = useRef<Set<string>>(new Set())
  // Terminals present at first load stay cold (no PTY, no agent resume) until
  // the user explicitly opens one — booting a big workspace must not launch
  // everything at once. Terminals created later auto-start (see shouldSpawn).
  const bootIdsRef = useRef<Set<string>>(new Set())
  const [startedIds, setStartedIds] = useState<ReadonlySet<string>>(new Set())
  const markStarted = useCallback((id: string) => {
    setStartedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])
  useEffect(() => {
    window.brain.loadWorkspace().then((ws) => {
      const initial = createInitialState(migrateWorkspace(ws))
      resumeIdsRef.current = new Set(
        allTerminals(initial).filter((t) => t.kind === 'claude' || t.kind === 'codex').map((t) => t.id)
      )
      bootIdsRef.current = new Set(allTerminals(initial).map((t) => t.id))
      setState(initial)
      setLoaded(true)
    }).catch((err) => {
      // `loaded` stays false, keeping the save effect gated off — a failed load
      // must never let an empty in-memory workspace overwrite the file on disk.
      console.error('[brain] failed to load workspace:', err)
      setLoadError(true)
    })
  }, [setState])

  useEffect(() => {
    if (!loaded) return
    window.brain.saveWorkspace(state.workspace)
  }, [state.workspace, loaded])

  // Kill a terminal's PTY only when it actually leaves the workspace (delete
  // terminal/feature/group) — NOT when its TerminalView unmounts, which also
  // happens on HMR/Fast Refresh remounts and must not disturb the running shell.
  const prevTermIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = new Set(allTerminals(state).map((t) => t.id))
    if (prevTermIds.current) {
      const removed = removedIds(prevTermIds.current, ids)
      for (const id of removed) window.brain.killPty(id)
      if (removed.length > 0) {
        // Drop the dead terminals' per-id UI state so these Records don't grow
        // for the whole session (and a future id reuse can't inherit stale state).
        setLiveAgents((m) => pruneRecord(m, removed))
        setBusy((m) => pruneRecord(m, removed))
        setReviewStatus((m) => pruneRecord(m, removed))
      }
    }
    prevTermIds.current = ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspace])

  // Which referenced document files still exist — drives the broken-doc rows.
  const [docExists, setDocExists] = useState<Record<string, boolean>>({})
  const docPathsKey = state.workspace.groups
    .flatMap((g) => g.features).flatMap((f) => f.documents ?? []).map((d) => d.path)
    .sort().join('\n')
  useEffect(() => {
    const paths = docPathsKey ? Array.from(new Set(docPathsKey.split('\n'))) : []
    let stale = false
    const check = () => {
      if (paths.length === 0) { setDocExists({}); return }
      void window.brain.pathsExist(paths).then((flags) => {
        if (stale) return
        const next: Record<string, boolean> = {}
        paths.forEach((p, i) => { next[p] = flags[i] })
        setDocExists(next)
      })
    }
    check()
    window.addEventListener('focus', check)
    return () => { stale = true; window.removeEventListener('focus', check) }
  }, [docPathsKey])

  const activeGroup = getActiveGroup(state)
  const activeFeature = getActiveFeature(state)

  const activeTerminal = getActiveTerminal(state)
  // The pipeline controls live on the feature's reviewer terminal (the one with a
  // review link); both origin and reviewer share the feature, so derive from it.
  const featureReviewer = activeFeature?.terminals.find((t) => !!t.review) ?? null
  const reviewerStatus = featureReviewer ? reviewStatus[featureReviewer.id] : undefined
  const originStatus = featureReviewer?.review ? reviewStatus[featureReviewer.review.originTerminalId] : undefined
  const reviewControl = {
    reviewerId: featureReviewer?.id ?? null,
    needsDecision: reviewerStatus === 'needs-decision',
    active: reviewerStatus === 'reviewing' || originStatus === 'applying'
  }
  const startReview = (args: ReviewStartArgs) => {
    if (!reviewReq) return
    markStarted(reviewReq.id) // the loop relays into the origin's PTY — it must be running
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
        if (state.activeFeatureId) { markLayoutChange(); apply((s) => toggleFeatureViewMode(s, state.activeFeatureId!)) }
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
      markStarted(next.id)
      apply((s) => setActiveTerminal(s, next.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, apply])

  const launchAgent = (featureId: string, kind: AgentKind) => {
    const a = AGENTS[kind]
    const id = createId()
    // claude lets us pin the conversation id up front (--session-id), so a restart
    // resumes THIS terminal's session, not the cwd's most-recent one. codex can't,
    // so it launches plain and we detect its session id from the rollout it writes.
    const sessionId = kind === 'claude' ? createId() : undefined
    apply((s) => addTerminal(s, featureId, { id, name: a.defaultName, startupCommand: agentLaunchCommand(kind, sessionId), kind, sessionId }))
    if (kind === 'codex') {
      const cwd = state.workspace.groups.find((g) => g.features.some((f) => f.id === featureId))?.cwd ?? ''
      // Exclude ids already on other terminals so a fresh codex never re-grabs a
      // session that's merely being resumed (its rollout looks recent on disk).
      const exclude = allTerminals(state).map((t) => t.sessionId).filter((s): s is string => !!s)
      void window.brain.captureAgentSession({ kind, cwd, exclude }).then((sid) => {
        if (sid) apply((s) => setTerminalSessionId(s, id, sid))
      })
    }
  }
  const finishExport = (res: ExportRunResult) => {
    transferRef.current = false
    setExportProgress(null)
    if (res.canceled) return
    if (res.ok) {
      const path = res.path ?? ''
      setExportNotice({
        text: `Exported to ${path}${res.warnings.length ? ` — ${res.warnings.length} session(s) without summary: ${res.warnings.join('; ')}` : ''}`,
        ...(path ? { path } : {})
      })
      // Summarization can take minutes — announce the finish even when the
      // window is in the background. Click focuses the app (existing behavior).
      window.brain.showNotification({
        key: `export:${path}`,
        title: 'Export finished',
        body: path.split(/[\\/]/).pop() || path
      })
    } else {
      setExportNotice({ text: `Export failed: ${res.warnings.join('; ') || 'unknown error'}` })
    }
  }
  const exportGroup = (groupId: string) => {
    if (transferRef.current) return
    const g = state.workspace.groups.find((x) => x.id === groupId)
    if (!g) return
    transferRef.current = true
    void window.brain.exportArchive({ scope: 'group', group: g }).then(finishExport)
  }
  const exportFeature = (featureId: string) => {
    if (transferRef.current) return
    const g = state.workspace.groups.find((x) => x.features.some((f) => f.id === featureId))
    const f = g?.features.find((x) => x.id === featureId)
    if (!g || !f) return
    transferRef.current = true
    void window.brain.exportArchive({ scope: 'feature', group: { name: g.name, cwd: g.cwd }, feature: f }).then(finishExport)
  }
  const importArchive = async () => {
    if (transferRef.current) return
    transferRef.current = true
    try {
      const res = await window.brain.importArchive()
      if (res.canceled) return
      if (res.error || !res.manifest || !res.dir) {
        setExportNotice({ text: `Import failed: ${res.error ?? 'unknown error'}` })
        return
      }
      // Old root missing on this machine → let the user point at the new one.
      // Canceling the picker just means every dead cwd falls back to home.
      const newRoot = res.cwdExists ? null : await window.brain.pickDirectory()
      const candidates = collectCwdCandidates(res.manifest, newRoot)
      const found = await window.brain.pathsExist(candidates)
      const existing = new Set(candidates.filter((_, i) => found[i]))
      const built = buildImport({
        manifest: res.manifest, dir: res.dir, newRoot,
        exists: (p) => existing.has(p), createId
      })
      // Imported terminals must stay cold until explicitly opened — without this,
      // adding them mid-session would auto-spawn every agent at once (spawnGate
      // treats non-boot ids as user-created). Must happen BEFORE the state update.
      for (const id of built.terminalIds) bootIdsRef.current.add(id)
      // Tell the user when the original project folder wasn't found and wasn't
      // remapped — their terminals will open in the home directory.
      const cwdNote = !res.cwdExists && !newRoot ? ' (original folder not found — terminals open in home)' : ''
      if (built.scope === 'group' && built.group) {
        const g = built.group
        apply((s) => addImportedGroup(s, g))
        setExportNotice({ text: `Imported project "${g.name}" — open a terminal to continue its session${cwdNote}` })
      } else if (built.feature) {
        const f = built.feature
        apply((s) => addImportedFeature(s, f, built.fallbackGroup))
        setExportNotice({ text: `Imported feature "${f.name}" — open a terminal to continue its session${cwdNote}` })
      }
    } catch (err) {
      // Foreign/hand-crafted archives can pass validation yet still surprise the
      // remap — surface it as a notice instead of an unhandled rejection.
      setExportNotice({ text: `Import failed: ${String(err)}` })
    } finally {
      transferRef.current = false
    }
  }
  const createGroup = (input: NewGroupInput) => {
    apply((s) => addGroup(s, input.name, input.cwd))
    setGroupDialogOpen(false)
  }

  // ALL terminals stay mounted so their shells keep running; hidden ones are just
  // omitted from the tab bar / grid (mounted but display:none).
  const terminals = allTerminals(state)
  const attentionItems = useMemo(() => attention.queue.map((q) => ({
    terminalId: q.terminalId, state: q.state, lastLine: q.lastLine, path: terminalPath(state, q.terminalId),
  })), [attention.queue, state.workspace]) // eslint-disable-line react-hooks/exhaustive-deps -- terminalPath reads only state.workspace
  // Both the tab bar and the grid show the visible (non-hidden) set: X-ing a
  // tab prunes its pane from the open grid too, and ENTERING grid mode clears
  // the feature's hidden set (store.toggleFeatureViewMode), so every terminal
  // returns on the next grid open.
  const featureVisible = (activeFeature?.terminals ?? []).filter((t) => !state.hidden.includes(t.id))
  const gridMode = (activeFeature?.viewMode ?? 'tabs') === 'grid'
  const featureTerminalIds = new Set(featureVisible.map((t) => t.id))
  const { cols, rows, lastSpan, spanFirst, flow: gridFlow } = styledGridLayout(featureVisible.length, activeFeature?.gridStyle ?? 'auto')
  // Auto-fill leaves any gap in one column (column flow) or one row (row flow);
  // the spanning pane stretches over it — first or last pane, per gridStyle.
  const spanTerminalId = spanFirst ? featureVisible[0]?.id : featureVisible[featureVisible.length - 1]?.id

  return (
    <div className="flex h-screen text-fg bg-panel">
      <Sidebar
        groups={state.workspace.groups}
        activeTerminalId={state.activeTerminalId}
        activeFeatureId={state.activeFeatureId}
        activeGroupId={state.activeGroupId}
        liveAgents={liveAgents}
        busy={busy}
        onSelectTerminal={(id) => { markStarted(id); apply((s) => showTerminal(s, id)) }}
        onToggleGroup={(id) => apply((s) => toggleGroupCollapsed(s, id))}
        onToggleFeature={(id) => apply((s) => toggleFeatureCollapsed(s, id))}
        onAddGroup={() => setGroupDialogOpen(true)}
        onAddFeature={(gid, name) => apply((s) => addFeature(s, gid, name))}
        onAddTerminal={(fid) => addShellTerminal(fid)}
        onLaunchAgent={launchAgent}
        onToggleFeatureView={(fid) => { markLayoutChange(); apply((s) => toggleFeatureViewMode(setActiveFeature(s, fid), fid)) }}
        onMoveGroup={(groupId, toIndex) => apply((s) => moveGroup(s, groupId, toIndex))}
        onMoveFeature={(featureId, toIndex) => apply((s) => moveFeature(s, featureId, toIndex))}
        onMoveTerminal={(terminalId, toIndex) => apply((s) => moveTerminal(s, terminalId, toIndex))}
        onRenameGroup={(id, name) => apply((s) => renameGroup(s, id, name))}
        onRenameFeature={(id, name) => apply((s) => renameFeature(s, id, name))}
        onRenameTerminal={(id, name) => apply((s) => renameTerminal(s, id, name))}
        onDeleteGroup={(id) => {
          const g = state.workspace.groups.find((x) => x.id === id)
          askDelete(`Delete project "${g?.name ?? ''}"? All its features and terminals will close.`, () => apply((s) => deleteGroup(s, id)))
        }}
        onDeleteFeature={(id) => {
          const f = state.workspace.groups.flatMap((g) => g.features).find((x) => x.id === id)
          askDelete(`Delete feature "${f?.name ?? ''}"? Its terminals will close.`, () => apply((s) => deleteFeature(s, id)))
        }}
        onDeleteTerminal={(id) => {
          const t = allTerminals(state).find((x) => x.id === id)
          askDelete(`Delete terminal "${t?.name ?? ''}"?`, () => {
            if (t?.review) review.stopLoop(id) // reviewer: stopLoop removes it and clears the origin's status
            else apply((s) => removeTerminal(s, id))
          })
        }}
        onOpenInFiles={(gid) => {
          const g = state.workspace.groups.find((x) => x.id === gid)
          window.brain.openPath(g?.cwd ?? '')
        }}
        onExportGroup={exportGroup}
        onExportFeature={exportFeature}
        onImport={() => void importArchive()}
        onArchiveFeature={(fid) => apply((s) => archiveFeature(s, fid))}
        onOpenArchive={(gid) => setArchiveGroupId(gid)}
        onAddDocument={(fid) => void addDocumentTo(fid)}
        onOpenDocument={(p) => window.brain.openPath(p)}
        onRenameDocument={(fid, did, name) => apply((s) => renameDocument(s, fid, did, name))}
        onRemoveDocument={(fid, did) => apply((s) => removeDocument(s, fid, did))}
        docExists={docExists}
        pendingRenameDocId={renameDocId}
        onPendingRenameDocConsumed={() => setRenameDocId(null)}
        reviewStatus={reviewStatus}
        onReviewTerminal={(id, reviewer) => setReviewReq({ id, reviewer })}
        pendingRenameTerminalId={renameTerminalId}
        onPendingRenameConsumed={() => setRenameTerminalId(null)}
        attention={attention.attention}
        attentionItems={attentionItems}
        attentionMuted={attention.muted}
        onAttentionSelect={(id) => { markStarted(id); apply((s) => showTerminal(s, id)); attention.clear(id) }}
        onAttentionClear={attention.clear}
        onAttentionClearAll={attention.clearAll}
        onToggleAttentionMute={attention.toggleMute}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {activeFeature && (
          <FeatureHeader
            featureName={activeFeature.name}
            viewMode={activeFeature.viewMode ?? 'tabs'}
            onToggleView={() => { markLayoutChange(); apply((s) => toggleFeatureViewMode(s, activeFeature.id)) }}
            onAdd={(kind) => (kind === 'shell'
              ? addShellTerminal(activeFeature.id)
              : launchAgent(activeFeature.id, kind))}
            review={reviewControl}
            onMoreRounds={(rid) => void review.moreRounds(rid)}
            onAcceptPhase={(rid) => review.acceptPhase(rid)}
            onStopLoop={(rid) => review.stopLoop(rid)}
            gridStyle={activeFeature.gridStyle ?? 'auto'}
            onSetGridStyle={(gs) => { markLayoutChange(); apply((s) => setFeatureGridStyle(s, activeFeature.id, gs)) }}
          />
        )}
        <TabBar
          terminals={featureVisible}
          activeId={state.activeTerminalId}
          liveAgents={liveAgents}
          busy={busy}
          onSelect={(id) => { markStarted(id); apply((s) => setActiveTerminal(s, id)) }}
          onClose={(id) => apply((s) => hideTerminal(s, id))}
          reviewStatus={reviewStatus}
          attention={attention.attention}
        />

        <div
          className={`relative flex-1 min-h-0 bg-surface ${gridMode ? 'grid gap-2 p-2 bg-panel' : ''}`}
          style={gridMode ? { gridAutoFlow: gridFlow, gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0,1fr))` } : undefined}
        >
          {featureVisible.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg-muted">
              <span className="text-2xl font-semibold tracking-tight text-fg">Brain</span>
              <span className="text-sm">
                {loadError
                  ? 'Workspace failed to load — saving is disabled to protect your data. Restart the app to retry.'
                  : activeGroup ? 'Add a terminal or open one from the sidebar.' : 'Create a project to get started.'}
              </span>
            </div>
          )}
          {terminals.map((t) => {
            const inFeature = featureTerminalIds.has(t.id)
            const isActive = t.id === state.activeTerminalId
            const griddedHere = gridMode && inFeature
            const dnd = griddedHere ? {
              dragging: gridDragId === t.id,
              isDropTarget: gridDropId === t.id && gridDragId !== t.id,
              onHandleDragStart: (e: React.DragEvent) => {
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                gridDragRef.current = t.id
                setGridDragId(t.id)
              },
              onDragEnd: () => clearGridDrag(),
              onDragOver: (e: React.DragEvent) => {
                const d = gridDragRef.current
                if (!d || d === t.id) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                if (gridDropId !== t.id) setGridDropId(t.id)
              },
              onDrop: (e: React.DragEvent) => {
                const d = gridDragRef.current
                if (!d || d === t.id) return
                e.preventDefault()
                const toIndex = activeFeature?.terminals.findIndex((x) => x.id === t.id) ?? -1
                if (toIndex !== -1) apply((s) => moveTerminal(s, d, toIndex))
                clearGridDrag()
              }
            } : undefined
            // Review-linked terminals are exempt from cold start: the loop's
            // relay writes into the origin's PTY and the reviewer must run to
            // produce its verdict, so a restored mid-review pair stays live.
            const started = shouldSpawn(t.id, bootIdsRef.current, startedIds) || isUnderReview(state, t.id)
            return (
              <TerminalPane
                key={t.id}
                terminal={t}
                active={isActive}
                gridded={griddedHere}
                gridRowSpan={griddedHere && gridFlow === 'column' && t.id === spanTerminalId ? lastSpan : undefined}
                gridColSpan={griddedHere && gridFlow === 'row' && t.id === spanTerminalId ? lastSpan : undefined}
                visibleInTabs={inFeature && !gridMode && isActive}
                busy={!!busy[t.id]}
                liveAgent={liveAgents[t.id]}
                reviewStatus={reviewStatus[t.id]}
                onActivate={() => { markStarted(t.id); apply((s) => setActiveTerminal(s, t.id)) }}
                dnd={dnd}
                resume={resumeIdsRef.current.has(t.id)}
                started={started}
                onStart={() => markStarted(t.id)}
              />
            )
          })}
        </div>
      </div>

      {groupDialogOpen && <NewGroupDialog onCreate={createGroup} onCancel={() => setGroupDialogOpen(false)} />}
      {archiveGroup && (
        <ArchiveDialog
          group={archiveGroup}
          onArchive={(fid) => apply((s) => archiveFeature(s, fid))}
          onRestore={restoreArchivedFeature}
          onDeleteArchived={(fid) => {
            const f = archiveGroup.archivedFeatures?.find((x) => x.id === fid)
            askDelete(`Permanently delete archived feature "${f?.name ?? ''}"? Its documents list goes with it.`, () =>
              apply((s) => deleteArchivedFeature(s, fid)))
          }}
          onClose={() => setArchiveGroupId(null)}
        />
      )}
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
      <ExportToast progress={exportProgress} notice={exportNotice} onDismiss={() => setExportNotice(null)} />
    </div>
  )
}

// src/renderer/src/App.tsx
import { useEffect, useState } from 'react'
import { useStore } from './useStore'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode,
  addTerminal, renameTerminal, removeTerminal,
  setActiveTerminal,
  getActiveGroup, getActiveFeature, allTerminals
} from './store'
import { migrateWorkspace } from './migrate'
import { AGENTS, type AgentKind } from './agents'
import { gridDimensions } from './layout'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { NewGroupDialog, NewGroupInput } from './components/NewGroupDialog'

export default function App() {
  const { state, setState, apply } = useStore()
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)

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

  const activeGroup = getActiveGroup(state)
  const activeFeature = getActiveFeature(state)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') {
        e.preventDefault()
        if (state.activeTerminalId) apply((s) => removeTerminal(s, state.activeTerminalId!))
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
      if (!f || f.terminals.length === 0) return
      const idx = f.terminals.findIndex((t) => t.id === state.activeTerminalId)
      const next = f.terminals[(idx + dir + f.terminals.length) % f.terminals.length]
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

  const terminals = allTerminals(state)
  const gridMode = (activeFeature?.viewMode ?? 'tabs') === 'grid'
  const featureTerminalIds = new Set((activeFeature?.terminals ?? []).map((t) => t.id))
  const { cols, rows } = gridDimensions(featureTerminalIds.size)

  return (
    <div className="flex h-screen text-fg bg-panel">
      <Sidebar
        groups={state.workspace.groups}
        activeTerminalId={state.activeTerminalId}
        onSelectTerminal={(id) => apply((s) => setActiveTerminal(s, id))}
        onToggleGroup={(id) => apply((s) => toggleGroupCollapsed(s, id))}
        onToggleFeature={(id) => apply((s) => toggleFeatureCollapsed(s, id))}
        onAddGroup={() => setGroupDialogOpen(true)}
        onAddFeature={(gid, name) => apply((s) => addFeature(s, gid, name))}
        onAddTerminal={(fid, name) => apply((s) => addTerminal(s, fid, { name }))}
        onLaunchAgent={launchAgent}
        onToggleFeatureView={(fid) => apply((s) => toggleFeatureViewMode(s, fid))}
        onRenameGroup={(id, name) => apply((s) => renameGroup(s, id, name))}
        onRenameFeature={(id, name) => apply((s) => renameFeature(s, id, name))}
        onRenameTerminal={(id, name) => apply((s) => renameTerminal(s, id, name))}
        onDeleteGroup={(id) => apply((s) => deleteGroup(s, id))}
        onDeleteFeature={(id) => apply((s) => deleteFeature(s, id))}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TabBar
          terminals={activeFeature?.terminals ?? []}
          activeId={state.activeTerminalId}
          viewMode={activeFeature?.viewMode ?? 'tabs'}
          onSelect={(id) => apply((s) => setActiveTerminal(s, id))}
          onClose={(id) => apply((s) => removeTerminal(s, id))}
          onAdd={() => { if (activeFeature) apply((s) => addTerminal(s, activeFeature.id, { name: 'shell' })) }}
          onLaunch={(kind) => { if (activeFeature) launchAgent(activeFeature.id, kind) }}
          onToggleView={() => { if (activeFeature) apply((s) => toggleFeatureViewMode(s, activeFeature.id)) }}
        />

        <div
          className={`relative flex-1 min-h-0 bg-surface ${gridMode ? 'grid gap-px bg-line' : ''}`}
          style={gridMode ? { gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0,1fr))` } : undefined}
        >
          {terminals.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg-muted">
              <span className="text-2xl font-semibold tracking-tight text-fg">Terminaltor</span>
              <span className="text-sm">{activeGroup ? 'Dodaj terminal u feature.' : 'Napravi grupu da počneš.'}</span>
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
    </div>
  )
}

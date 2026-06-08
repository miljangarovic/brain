// src/renderer/src/App.tsx
import { useEffect, useState } from 'react'
import { useStore } from './useStore'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed, toggleGroupViewMode,
  addTerminal, removeTerminal, setActiveTerminal,
  getActiveGroup, allTerminals
} from './store'
import { AGENTS, type AgentKind } from './agents'
import { gridDimensions } from './layout'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { NewTerminalDialog, NewTerminalInput } from './components/NewTerminalDialog'

export default function App() {
  const { state, setState, apply } = useStore()
  const [dialogGroupId, setDialogGroupId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Load persisted workspace once on mount.
  useEffect(() => {
    window.terminaltor.loadWorkspace().then((ws) => {
      setState(createInitialState(ws))
      setLoaded(true)
    })
  }, [setState])

  // Persist whenever the workspace changes (main debounces writes).
  // Gated on `loaded` so the initial empty state can never overwrite the saved
  // workspace before loadWorkspace() resolves.
  useEffect(() => {
    if (!loaded) return
    window.terminaltor.saveWorkspace(state.workspace)
  }, [state.workspace, loaded])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {       // new terminal in active group
        e.preventDefault()
        if (state.activeGroupId) setDialogGroupId(state.activeGroupId)
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') { // close active terminal
        e.preventDefault()
        if (state.activeTerminalId) apply((s) => removeTerminal(s, state.activeTerminalId!))
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyG') { // toggle grid/tabs for active group
        e.preventDefault()
        if (state.activeGroupId) apply((s) => toggleGroupViewMode(s, state.activeGroupId!))
      } else if (e.ctrlKey && e.code === 'PageDown') {          // next tab in active group
        e.preventDefault()
        cycleTab(1)
      } else if (e.ctrlKey && e.code === 'PageUp') {            // previous tab
        e.preventDefault()
        cycleTab(-1)
      }
    }
    const cycleTab = (dir: number) => {
      const group = getActiveGroup(state)
      if (!group || group.terminals.length === 0) return
      const idx = group.terminals.findIndex((t) => t.id === state.activeTerminalId)
      const next = group.terminals[(idx + dir + group.terminals.length) % group.terminals.length]
      apply((s) => setActiveTerminal(s, next.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, apply])

  const activeGroup = getActiveGroup(state)
  const terminals = allTerminals(state)

  const openDialog = () => {
    const gid = state.activeGroupId
    if (gid) setDialogGroupId(gid)
  }
  const createTerminal = (input: NewTerminalInput) => {
    if (dialogGroupId) apply((s) => addTerminal(s, dialogGroupId, input))
    setDialogGroupId(null)
  }
  const launchAgent = (groupId: string, kind: AgentKind) => {
    const agent = AGENTS[kind]
    apply((s) => addTerminal(s, groupId, { name: agent.defaultName, cwd: '', startupCommand: agent.command, kind }))
  }

  return (
    <div className="flex h-screen text-fg bg-panel">
      <Sidebar
        groups={state.workspace.groups}
        activeTerminalId={state.activeTerminalId}
        onSelectTerminal={(id) => apply((s) => setActiveTerminal(s, id))}
        onToggleGroup={(id) => apply((s) => toggleGroupCollapsed(s, id))}
        onAddGroup={(name) => apply((s) => addGroup(s, name))}
        onRenameGroup={(id, name) => apply((s) => renameGroup(s, id, name))}
        onAddTerminal={(gid) => setDialogGroupId(gid)}
        onDeleteGroup={(id) => apply((s) => deleteGroup(s, id))}
        onLaunchAgent={launchAgent}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TabBar
          terminals={activeGroup?.terminals ?? []}
          activeId={state.activeTerminalId}
          onSelect={(id) => apply((s) => setActiveTerminal(s, id))}
          onClose={(id) => apply((s) => removeTerminal(s, id))}
          onAdd={openDialog}
          onLaunch={(kind) => { if (state.activeGroupId) launchAgent(state.activeGroupId, kind) }}
          viewMode={activeGroup?.viewMode ?? 'tabs'}
          onToggleView={() => { if (activeGroup) apply((s) => toggleGroupViewMode(s, activeGroup.id)) }}
        />

        {(() => {
          const gridMode = (activeGroup?.viewMode ?? 'tabs') === 'grid'
          const groupTerminalIds = new Set((activeGroup?.terminals ?? []).map((t) => t.id))
          const { cols, rows } = gridDimensions(groupTerminalIds.size)
          return (
            <div
              className={`relative flex-1 min-h-0 bg-surface ${gridMode ? 'grid gap-px bg-line' : ''}`}
              style={gridMode ? {
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
              } : undefined}
            >
              {terminals.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg-muted">
                  <span className="text-2xl font-semibold tracking-tight text-fg">Terminaltor</span>
                  <span className="text-sm">Napravi grupu pa terminal da počneš.</span>
                </div>
              )}
              {/* All terminals stay mounted (stable siblings) so shells survive view switches. */}
              {terminals.map((t) => {
                const inActive = groupTerminalIds.has(t.id)
                const isActive = t.id === state.activeTerminalId
                if (gridMode && inActive) {
                  return (
                    <div
                      key={t.id}
                      onMouseDown={() => apply((s) => setActiveTerminal(s, t.id))}
                      className={`relative min-h-0 min-w-0 bg-surface border ${isActive ? 'border-accent' : 'border-transparent'}`}
                    >
                      <TerminalView terminal={t} active={isActive} />
                    </div>
                  )
                }
                const visible = inActive && !gridMode && isActive
                return (
                  <div
                    key={t.id}
                    className="absolute inset-0"
                    style={{ display: visible ? 'block' : 'none' }}
                  >
                    <TerminalView terminal={t} active={isActive} />
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>

      {dialogGroupId && (
        <NewTerminalDialog onCreate={createTerminal} onCancel={() => setDialogGroupId(null)} />
      )}
    </div>
  )
}

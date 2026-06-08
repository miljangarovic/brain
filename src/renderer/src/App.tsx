// src/renderer/src/App.tsx
import { useEffect, useState } from 'react'
import { useStore } from './useStore'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed,
  addTerminal, removeTerminal, setActiveTerminal,
  getActiveGroup, allTerminals
} from './store'
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

  return (
    <div className="flex h-screen text-gray-200 bg-gray-900">
      <Sidebar
        groups={state.workspace.groups}
        activeTerminalId={state.activeTerminalId}
        onSelectTerminal={(id) => apply((s) => setActiveTerminal(s, id))}
        onToggleGroup={(id) => apply((s) => toggleGroupCollapsed(s, id))}
        onAddGroup={(name) => apply((s) => addGroup(s, name))}
        onRenameGroup={(id, name) => apply((s) => renameGroup(s, id, name))}
        onAddTerminal={(gid) => setDialogGroupId(gid)}
        onDeleteGroup={(id) => apply((s) => deleteGroup(s, id))}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TabBar
          terminals={activeGroup?.terminals ?? []}
          activeId={state.activeTerminalId}
          onSelect={(id) => apply((s) => setActiveTerminal(s, id))}
          onClose={(id) => apply((s) => removeTerminal(s, id))}
          onAdd={openDialog}
        />

        <div className="relative flex-1 bg-[#0d1117]">
          {terminals.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-600">
              Napravi grupu pa terminal da počneš.
            </div>
          )}
          {/* All terminals stay mounted so their shells keep running while hidden. */}
          {terminals.map((t) => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ display: t.id === state.activeTerminalId ? 'block' : 'none' }}
            >
              <TerminalView terminal={t} active={t.id === state.activeTerminalId} />
            </div>
          ))}
        </div>
      </div>

      {dialogGroupId && (
        <NewTerminalDialog onCreate={createTerminal} onCancel={() => setDialogGroupId(null)} />
      )}
    </div>
  )
}

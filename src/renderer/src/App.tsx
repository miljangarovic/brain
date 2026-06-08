// src/renderer/src/App.tsx
import { useEffect, useState } from 'react'
import { useStore } from './useStore'
import {
  createInitialState, addGroup, deleteGroup, toggleGroupCollapsed,
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

  // Load persisted workspace once on mount.
  useEffect(() => {
    window.terminaltor.loadWorkspace().then((ws) => setState(createInitialState(ws)))
  }, [setState])

  // Persist whenever the workspace changes (main debounces writes).
  useEffect(() => {
    window.terminaltor.saveWorkspace(state.workspace)
  }, [state.workspace])

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

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { TerminaltorApi } from '../shared/api'
import type { Workspace } from '../shared/types'
import type { PtyCreateOptions } from '../shared/pty'

const api: TerminaltorApi = {
  loadWorkspace: () => ipcRenderer.invoke(IPC.workspaceLoad) as Promise<Workspace>,
  saveWorkspace: (ws: Workspace) => ipcRenderer.send(IPC.workspaceSave, ws),
  createPty: (opts: PtyCreateOptions) => ipcRenderer.send(IPC.ptyCreate, opts),
  writePty: (id, data) => ipcRenderer.send(IPC.ptyInput, { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, { id, cols, rows }),
  killPty: (id) => ipcRenderer.send(IPC.ptyKill, { id }),
  onPtyData: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { id: string; data: string }) => cb(p.id, p.data)
    ipcRenderer.on(IPC.ptyData, listener)
    return () => ipcRenderer.removeListener(IPC.ptyData, listener)
  },
  onPtyExit: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { id: string; code: number }) => cb(p.id, p.code)
    ipcRenderer.on(IPC.ptyExit, listener)
    return () => ipcRenderer.removeListener(IPC.ptyExit, listener)
  },
  pickDirectory: () => ipcRenderer.invoke(IPC.dialogPickDirectory) as Promise<string | null>,
  openPath: (path: string) => ipcRenderer.send(IPC.shellOpenPath, { path }),
  onPtyProc: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { id: string; process: string }) => cb(p.id, p.process)
    ipcRenderer.on(IPC.ptyProc, listener)
    return () => ipcRenderer.removeListener(IPC.ptyProc, listener)
  },
}

contextBridge.exposeInMainWorld('terminaltor', api)

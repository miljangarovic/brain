import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { OrchestrixApi } from '../shared/api'
import type { Workspace } from '../shared/types'
import type { PtyCreateOptions } from '../shared/pty'

const api: OrchestrixApi = {
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
  onPtyBusy: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { id: string; busy: boolean }) => cb(p.id, p.busy)
    ipcRenderer.on(IPC.ptyBusy, listener)
    return () => ipcRenderer.removeListener(IPC.ptyBusy, listener)
  },
  pickFile: (opts) => ipcRenderer.invoke(IPC.dialogPickFile, opts ?? {}) as Promise<string | null>,
  suggestSpec: (cwd) => ipcRenderer.invoke(IPC.reviewSuggestSpec, cwd) as Promise<string | null>,
  resolveReviewDir: (originTerminalId, round) =>
    ipcRenderer.invoke(IPC.reviewResolveDir, { originTerminalId, round }) as Promise<{ reviewDir: string; reviewFile: string }>,
  watchFile: (watchId, path) => ipcRenderer.send(IPC.fsWatch, { watchId, path }),
  unwatchFile: (watchId) => ipcRenderer.send(IPC.fsUnwatch, { watchId }),
  onFsChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { watchId: string }) => cb(p.watchId)
    ipcRenderer.on(IPC.fsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.fsChanged, listener)
  },
}

contextBridge.exposeInMainWorld('orchestrix', api)

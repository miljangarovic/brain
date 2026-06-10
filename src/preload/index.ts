import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { BrainApi } from '../shared/api'
import type { Workspace } from '../shared/types'
import type { PtyCreateOptions } from '../shared/pty'

// pty:data / pty:exit are consumed by EVERY mounted terminal, and all terminals
// stay mounted — so one ipcRenderer listener per terminal trips the default
// 10-listener cap (MaxListenersExceeded warning) once ~10 terminals are open.
// Keep a single ipcRenderer listener per channel and fan out to local
// subscribers; each subscriber still filters by its own terminal id.
const ptyDataSubs = new Set<(id: string, data: string) => void>()
ipcRenderer.on(IPC.ptyData, (_e, p: { id: string; data: string }) => {
  for (const cb of ptyDataSubs) cb(p.id, p.data)
})
const ptyExitSubs = new Set<(id: string, code: number) => void>()
ipcRenderer.on(IPC.ptyExit, (_e, p: { id: string; code: number }) => {
  for (const cb of ptyExitSubs) cb(p.id, p.code)
})

const api: BrainApi = {
  loadWorkspace: () => ipcRenderer.invoke(IPC.workspaceLoad) as Promise<Workspace>,
  saveWorkspace: (ws: Workspace) => ipcRenderer.send(IPC.workspaceSave, ws),
  createPty: (opts: PtyCreateOptions) => ipcRenderer.send(IPC.ptyCreate, opts),
  writePty: (id, data) => ipcRenderer.send(IPC.ptyInput, { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, { id, cols, rows }),
  killPty: (id) => ipcRenderer.send(IPC.ptyKill, { id }),
  onPtyData: (cb) => { ptyDataSubs.add(cb); return () => { ptyDataSubs.delete(cb) } },
  onPtyExit: (cb) => { ptyExitSubs.add(cb); return () => { ptyExitSubs.delete(cb) } },
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
  resolveReviewDir: (originTerminalId, phase, round) =>
    ipcRenderer.invoke(IPC.reviewResolveDir, { originTerminalId, phase, round }) as Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }>,
  resolveTranscript: (cwd, kind) =>
    ipcRenderer.invoke(IPC.reviewResolveTranscript, { cwd, kind }) as Promise<string | null>,
  readTextFile: (path) => ipcRenderer.invoke(IPC.fsRead, { path }) as Promise<string | null>,
  watchFile: (watchId, path) => ipcRenderer.send(IPC.fsWatch, { watchId, path }),
  unwatchFile: (watchId) => ipcRenderer.send(IPC.fsUnwatch, { watchId }),
  onFsChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { watchId: string }) => cb(p.watchId)
    ipcRenderer.on(IPC.fsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.fsChanged, listener)
  },
  captureAgentSession: (opts) => ipcRenderer.invoke(IPC.agentCaptureSession, opts) as Promise<string | null>,
  showNotification: (opts) => ipcRenderer.send(IPC.notifyShow, opts),
  onNotificationClick: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { key: string }) => cb(p.key)
    ipcRenderer.on(IPC.notificationClick, listener)
    return () => ipcRenderer.removeListener(IPC.notificationClick, listener)
  },
  resolvePathLinks: (opts) => ipcRenderer.invoke(IPC.linksResolve, opts) as Promise<(string | null)[]>,
}

contextBridge.exposeInMainWorld('brain', api)

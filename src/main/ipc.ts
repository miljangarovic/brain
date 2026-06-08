// src/main/ipc.ts
import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import * as os from 'os'
import { IPC } from '@shared/ipc'
import { PtyManager } from './ptyManager'
import { createBusyTracker } from './busyTracker'
import { loadWorkspace, createDebouncedSaver } from './persistence'
import type { Workspace } from '@shared/types'
import type { PtyCreateOptions } from '@shared/pty'
import { suggestSpec, resolveReviewPaths } from './reviewFs'
import { createReviewWatcher } from './reviewWatcher'

// Registers all IPC channels exactly once. PTY data/exit are forwarded to the
// CURRENT window via getWin() (so window re-creation doesn't leave a stale ref).
// Returns the debounced saver so the caller can flush it on quit.
export function registerIpc(opts: {
  getWin: () => BrowserWindow | null
  ptyManager: PtyManager
  workspacePath: string
  userDataDir: string
}) {
  const { getWin, ptyManager, workspacePath, userDataDir } = opts
  const saver = createDebouncedSaver(workspacePath)

  const send = (channel: string, payload: unknown) => {
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const busy = createBusyTracker((id, isBusy) => send(IPC.ptyBusy, { id, busy: isBusy }))
  ptyManager.onData((id, data) => { send(IPC.ptyData, { id, data }); busy.touch(id) })
  ptyManager.onExit((id, code) => { send(IPC.ptyExit, { id, code }); busy.end(id) })

  ipcMain.handle(IPC.workspaceLoad, () => loadWorkspace(workspacePath))
  ipcMain.on(IPC.workspaceSave, (_e, ws: Workspace) => saver.save(ws))
  ipcMain.on(IPC.ptyCreate, (_e, o: PtyCreateOptions) => ptyManager.create(o))
  ipcMain.on(IPC.ptyInput, (_e, p: { id: string; data: string }) => ptyManager.write(p.id, p.data))
  ipcMain.on(IPC.ptyResize, (_e, p: { id: string; cols: number; rows: number }) => ptyManager.resize(p.id, p.cols, p.rows))
  ipcMain.on(IPC.ptyKill, (_e, p: { id: string }) => ptyManager.kill(p.id))

  ipcMain.handle(IPC.dialogPickDirectory, async () => {
    const win = getWin()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  ipcMain.on(IPC.shellOpenPath, (_e, p: { path: string }) => { void shell.openPath(p.path || os.homedir()) })

  // Poll each PTY's foreground process name; push changes so the renderer can
  // show a live agent icon (claude/codex) and revert it when the agent exits.
  const lastProc = new Map<string, string>()
  setInterval(() => {
    const win = getWin()
    if (!win || win.isDestroyed()) return
    const snap = ptyManager.snapshotProcesses()
    const live = new Set(snap.map((s) => s.id))
    for (const id of lastProc.keys()) if (!live.has(id)) lastProc.delete(id) // drop dead terminals
    for (const { id, process } of snap) {
      if (lastProc.get(id) !== process) {
        lastProc.set(id, process)
        win.webContents.send(IPC.ptyProc, { id, process })
      }
    }
  }, 1000)

  ipcMain.handle(IPC.dialogPickFile, async (_e, o: { defaultPath?: string }) => {
    const win = getWin()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }, { name: 'Sve', extensions: ['*'] }],
      ...(o?.defaultPath ? { defaultPath: o.defaultPath } : {})
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.reviewSuggestSpec, (_e, cwd: string) => suggestSpec(cwd || os.homedir()))

  ipcMain.handle(IPC.reviewResolveDir, (_e, p: { originTerminalId: string; round: number }) =>
    resolveReviewPaths(userDataDir, p.originTerminalId, p.round))

  const reviewWatcher = createReviewWatcher((watchId) => send(IPC.fsChanged, { watchId }))
  ipcMain.on(IPC.fsWatch, (_e, p: { watchId: string; path: string }) => reviewWatcher.watch(p.watchId, p.path))
  ipcMain.on(IPC.fsUnwatch, (_e, p: { watchId: string }) => reviewWatcher.unwatch(p.watchId))

  return saver
}

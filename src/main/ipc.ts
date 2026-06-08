// src/main/ipc.ts
import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import * as os from 'os'
import { IPC } from '@shared/ipc'
import { PtyManager } from './ptyManager'
import { loadWorkspace, createDebouncedSaver } from './persistence'
import type { Workspace } from '@shared/types'
import type { PtyCreateOptions } from '@shared/pty'

// Registers all IPC channels exactly once. PTY data/exit are forwarded to the
// CURRENT window via getWin() (so window re-creation doesn't leave a stale ref).
// Returns the debounced saver so the caller can flush it on quit.
export function registerIpc(opts: {
  getWin: () => BrowserWindow | null
  ptyManager: PtyManager
  workspacePath: string
}) {
  const { getWin, ptyManager, workspacePath } = opts
  const saver = createDebouncedSaver(workspacePath)

  const send = (channel: string, payload: unknown) => {
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  ptyManager.onData((id, data) => send(IPC.ptyData, { id, data }))
  ptyManager.onExit((id, code) => send(IPC.ptyExit, { id, code }))

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

  return saver
}

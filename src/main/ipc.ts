// src/main/ipc.ts
import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { PtyManager } from './ptyManager'
import { loadWorkspace, createDebouncedSaver } from './persistence'
import type { Workspace } from '@shared/types'
import type { PtyCreateOptions } from '@shared/pty'

export function registerIpc(opts: {
  win: BrowserWindow
  ptyManager: PtyManager
  workspacePath: string
}): void {
  const { win, ptyManager, workspacePath } = opts
  const saver = createDebouncedSaver(workspacePath)

  ptyManager.onData((id, data) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ptyData, { id, data })
  })
  ptyManager.onExit((id, code) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ptyExit, { id, code })
  })

  ipcMain.handle(IPC.workspaceLoad, () => loadWorkspace(workspacePath))
  ipcMain.on(IPC.workspaceSave, (_e, ws: Workspace) => saver.save(ws))
  ipcMain.on(IPC.ptyCreate, (_e, o: PtyCreateOptions) => ptyManager.create(o))
  ipcMain.on(IPC.ptyInput, (_e, p: { id: string; data: string }) => ptyManager.write(p.id, p.data))
  ipcMain.on(IPC.ptyResize, (_e, p: { id: string; cols: number; rows: number }) => ptyManager.resize(p.id, p.cols, p.rows))
  ipcMain.on(IPC.ptyKill, (_e, p: { id: string }) => ptyManager.kill(p.id))
}

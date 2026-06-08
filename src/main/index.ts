// src/main/index.ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { PtyManager } from './ptyManager'
import { nodePtySpawner } from './nodePtySpawner'
import { registerIpc } from './ipc'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#0d1117',
    title: 'Terminaltor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  const ptyManager = new PtyManager(nodePtySpawner)
  registerIpc({
    win,
    ptyManager,
    workspacePath: join(app.getPath('userData'), 'workspace.json')
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

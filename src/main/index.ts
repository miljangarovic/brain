// src/main/index.ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { PtyManager } from './ptyManager'
import { nodePtySpawner } from './nodePtySpawner'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager(nodePtySpawner)

function createWindow(): void {
  // Dev (Linux/Windows) taskbar icon. A packaged build uses the icon embedded
  // by electron-builder, and `assets/` is not bundled — so existsSync makes this
  // a no-op in production and it only kicks in while developing.
  const iconPath = join(app.getAppPath(), 'assets', 'branding', 'png', 'terminaltor-256.png')
  const icon = existsSync(iconPath) ? iconPath : undefined

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#21252b',
    title: 'Terminaltor',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => { mainWindow = null })
  mainWindow = win

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // IPC is registered ONCE here (not per-window) so re-creating the window can
  // never register a second 'workspace:load' handler or stack duplicate listeners.
  const saver = registerIpc({
    getWin: () => mainWindow,
    ptyManager,
    workspacePath: join(app.getPath('userData'), 'workspace.json')
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Guarantee the latest workspace reaches disk before quitting (the debounced
  // saver may have an unwritten change within its delay window).
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    e.preventDefault()
    quitting = true
    void saver.flushNow().finally(() => app.quit())
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

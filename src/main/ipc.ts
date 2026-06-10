// src/main/ipc.ts
import { ipcMain, BrowserWindow, dialog, shell, Notification } from 'electron'
import * as os from 'os'
import { IPC } from '@shared/ipc'
import { PtyManager } from './ptyManager'
import { createBusyTracker } from './busyTracker'
import { createDebouncedSaver } from './persistence'
import type { Workspace, ReviewPhase } from '@shared/types'
import type { PtyCreateOptions } from '@shared/pty'
import { suggestSpec, resolveReviewPaths } from './reviewFs'
import { createReviewWatcher } from './reviewWatcher'
import { createNotifier } from './notifications'
import { resolveTranscript } from './transcript'
import { resolveExistingPaths } from './pathLinks'
import { codexSessionsDir, findCodexSessionId } from './codexSession'
import { promises as fsp } from 'fs'
import { runExport, extractImportArchive, slugify } from './exportImport'
import { summarizeSession } from './sessionSummary'
import type { ExportScopeInput } from '@shared/exportTypes'
import { randomUUID } from 'crypto'
import { join } from 'path'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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

  // The spinner reflects an AI agent producing a response. Agents stream with
  // pauses (model latency, tool use, sparse TUI redraws while generating code), so
  // a short idle window would flicker the spinner off mid-answer — wait longer
  // before declaring idle. (Only agent terminals show the spinner, gated in the
  // renderer, so this longer tail is invisible on plain shells.)
  const AGENT_IDLE_MS = 1500
  const busy = createBusyTracker((id, isBusy) => send(IPC.ptyBusy, { id, busy: isBusy }), AGENT_IDLE_MS)
  ptyManager.onData((id, data) => { send(IPC.ptyData, { id, data }); busy.touch(id) })
  ptyManager.onExit((id, code) => { send(IPC.ptyExit, { id, code }); busy.end(id) })

  // loadLatest flushes any pending debounced save first, so a renderer reload
  // inside the debounce window can't read (and then re-persist) stale state.
  ipcMain.handle(IPC.workspaceLoad, () => saver.loadLatest())
  ipcMain.on(IPC.workspaceSave, (_e, ws: Workspace) => saver.save(ws))
  ipcMain.on(IPC.ptyCreate, (_e, o: PtyCreateOptions) => ptyManager.create(o))
  ipcMain.on(IPC.ptyInput, (_e, p: { id: string; data: string }) => { ptyManager.write(p.id, p.data); busy.input(p.id) })
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

  ipcMain.handle(IPC.reviewResolveDir, (_e, p: { originTerminalId: string; phase: ReviewPhase; round: number }) =>
    resolveReviewPaths(userDataDir, p.originTerminalId, p.phase, p.round))

  ipcMain.handle(IPC.reviewResolveTranscript, (_e, p: { cwd: string; kind?: string }) =>
    resolveTranscript({ cwd: p.cwd || os.homedir(), kind: p.kind }))

  // Ctrl+click file links: resolve printed path candidates against the
  // terminal's cwd and report which actually exist (null = offer no link).
  ipcMain.handle(IPC.linksResolve, (_e, p: { cwd: string; candidates: string[] }) =>
    resolveExistingPaths(p?.cwd ?? '', p?.candidates ?? []))

  // Best-effort utf8 read for the renderer (e.g. parsing a review file's verdict).
  // Returns null on any error (missing/unreadable) — the caller treats that as "no content".
  ipcMain.handle(IPC.fsRead, async (_e, p: { path: string }) => {
    try { return await fsp.readFile(p.path, 'utf8') } catch { return null }
  })

  const reviewWatcher = createReviewWatcher((watchId) => send(IPC.fsChanged, { watchId }))
  ipcMain.on(IPC.fsWatch, (_e, p: { watchId: string; path: string }) => reviewWatcher.watch(p.watchId, p.path))
  ipcMain.on(IPC.fsUnwatch, (_e, p: { watchId: string }) => reviewWatcher.unwatch(p.watchId))

  // Native OS notification when an agent needs the user. Click focuses the window
  // and tells the renderer which terminal to jump to (key === terminalId).
  const notifier = createNotifier({
    isSupported: () => Notification.isSupported(),
    create: ({ title, body }) => new Notification({ title, body }),
    onClick: (key) => {
      const win = getWin()
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
      send(IPC.notificationClick, { key })
    }
  })
  ipcMain.on(IPC.notifyShow, (_e, p: { key: string; title: string; body: string }) => notifier.show(p))

  // Detect the session id a freshly launched codex terminal writes, so a later
  // restart resumes exactly that conversation. `claimed` lives for the app run so
  // two concurrent captures never hand out the same id; the mtime + cwd filters
  // (in findCodexSessionId) keep us off old/other sessions. Best-effort: returns
  // null if codex hasn't written a matching rollout within the poll window.
  const claimedCodex = new Set<string>()
  ipcMain.handle(IPC.agentCaptureSession, async (_e, p: { kind: string; cwd: string; exclude?: string[] }) => {
    if (p.kind !== 'codex') return null
    const cwd = p.cwd || os.homedir()
    const root = codexSessionsDir()
    const excluded = new Set(p.exclude ?? [])  // ids already on other terminals — never hand out twice
    const sinceMs = Date.now()                 // captured before codex spawns, so its session is born after this
    for (let i = 0; i < 30; i++) {             // ~15s: codex writes its rollout shortly after start
      const id = await findCodexSessionId({ root, cwd, sinceMs, claimed: claimedCodex, excluded })
      if (id) { claimedCodex.add(id); return id }
      await delay(500)
    }
    return null
  })

  const pathExists = (p: string): Promise<boolean> => fsp.access(p).then(() => true, () => false)

  // Export a project/feature: ask where to save FIRST (cancel costs nothing),
  // then summarize each agent session headlessly and write the archive.
  ipcMain.handle(IPC.exportRun, async (_e, input: ExportScopeInput) => {
    const win = getWin()
    const name = input.scope === 'group' ? input.group.name : input.feature.name
    const options: Electron.SaveDialogOptions = {
      defaultPath: `${slugify(name)}-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { ok: false, canceled: true, warnings: [] }
    try {
      const { warnings } = await runExport({
        input,
        outPath: res.filePath,
        summarize: (ref) => summarizeSession({ kind: ref.kind, sessionId: ref.sessionId, cwd: ref.cwd }),
        onProgress: (p) => send(IPC.exportProgress, p)
      })
      return { ok: true, path: res.filePath, warnings }
    } catch (err) {
      return { ok: false, warnings: [String(err)] }
    }
  })

  // Import an exported zip: extract under userData/imports/<uuid>/ (the session
  // .md files live there permanently — imported startup prompts reference them).
  ipcMain.handle(IPC.importRun, async () => {
    const win = getWin()
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    try {
      const out = await extractImportArchive(res.filePaths[0], join(userDataDir, 'imports', randomUUID()))
      if ('error' in out) return { error: out.error }
      const root = out.manifest.group.cwd
      return { manifest: out.manifest, dir: out.dir, cwdExists: root === '' ? true : await pathExists(root) }
    } catch (err) {
      // fs failures during extraction (EACCES, ENOSPC, ...) must surface as a
      // result, not a rejected invoke — the renderer only handles { error }.
      return { error: String(err) }
    }
  })

  ipcMain.handle(IPC.fsExists, (_e, p: { paths: string[] }) => Promise.all((p?.paths ?? []).map(pathExists)))

  return saver
}

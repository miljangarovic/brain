import type { Workspace } from './types'
import type { PtyCreateOptions } from './pty'
import type { ReviewPhase } from './types'
import type { ExportProgress, ExportRunResult, ExportScopeInput, ImportRunResult } from './exportTypes'

export interface BrainApi {
  loadWorkspace(): Promise<Workspace>
  saveWorkspace(ws: Workspace): void
  createPty(opts: PtyCreateOptions): void
  // `user` distinguishes the user's own typing/paste from synthetic terminal
  // data (xterm auto-replies, mouse-tracking reports). Only user input feeds
  // the busy tracker's typing suppression; default (undefined) counts as user.
  writePty(id: string, data: string, user?: boolean): void
  resizePty(id: string, cols: number, rows: number): void
  killPty(id: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, code: number) => void): () => void
  pickDirectory(): Promise<string | null>
  openPath(path: string): void
  onPtyProc(cb: (id: string, process: string) => void): () => void
  onPtyBusy(cb: (id: string, busy: boolean) => void): () => void
  pickFile(opts?: { defaultPath?: string }): Promise<string | null>
  suggestSpec(cwd: string): Promise<string | null>
  resolveReviewDir(originTerminalId: string, phase: ReviewPhase, round: number): Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }>
  resolveTranscript(cwd: string, kind?: string): Promise<string | null>
  readTextFile(path: string): Promise<string | null>
  watchFile(watchId: string, path: string): void
  unwatchFile(watchId: string): void
  onFsChanged(cb: (watchId: string) => void): () => void
  // Best-effort: after a fresh agent launch, resolve the conversation/session id
  // it created (currently codex only — claude pins its id up front). Returns null
  // if none is found within the capture window.
  captureAgentSession(opts: { kind: string; cwd: string; exclude?: string[] }): Promise<string | null>
  showNotification(opts: { key: string; title: string; body: string }): void
  onNotificationClick(cb: (key: string) => void): () => void
  // Resolve printed path candidates against a terminal's cwd; index-aligned
  // result, null where no such file exists (no link is offered).
  resolvePathLinks(opts: { cwd: string; candidates: string[] }): Promise<(string | null)[]>
  // Export a project/feature to a zip: save dialog first, then headless session
  // summarization in the main process; progress arrives via onExportProgress.
  exportArchive(input: ExportScopeInput): Promise<ExportRunResult>
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  // Pick an exported zip, extract it under userData/imports/, return the manifest.
  importArchive(): Promise<ImportRunResult>
  pathsExist(paths: string[]): Promise<boolean[]>
}

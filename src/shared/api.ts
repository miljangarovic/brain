import type { Workspace } from './types'
import type { PtyCreateOptions } from './pty'
import type { ReviewPhase } from './types'

export interface OrchestrixApi {
  loadWorkspace(): Promise<Workspace>
  saveWorkspace(ws: Workspace): void
  createPty(opts: PtyCreateOptions): void
  writePty(id: string, data: string): void
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
}

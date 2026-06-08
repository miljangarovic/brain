import type { Workspace } from './types'
import type { PtyCreateOptions } from './pty'

export interface TerminaltorApi {
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
  resolveReviewDir(originTerminalId: string, round: number): Promise<{ reviewDir: string; reviewFile: string }>
  watchFile(watchId: string, path: string): void
  unwatchFile(watchId: string): void
  onFsChanged(cb: (watchId: string) => void): () => void
}

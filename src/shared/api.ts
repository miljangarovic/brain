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
}

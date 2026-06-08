export interface PtyCreateOptions {
  id: string
  cwd: string
  shell: string
  cols: number
  rows: number
  startupCommand?: string
}

export interface PtyHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (exitCode: number) => void): void
}

export type PtySpawner = (opts: {
  shell: string
  cwd: string
  cols: number
  rows: number
}) => PtyHandle

// How long a PTY must stay silent before the busy tracker calls an agent
// terminal idle. Shared because the renderer needs it too: busy=false arrives
// this long AFTER the last output chunk, so honest output-span math (attention's
// blip filter) must subtract it.
export const AGENT_IDLE_MS = 1500

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
  processName(): string
}

export type PtySpawner = (opts: {
  shell: string
  cwd: string
  cols: number
  rows: number
}) => PtyHandle

import type { PtyHandle, PtySpawner, PtyCreateOptions } from '@shared/pty'

export class PtyManager {
  private handles = new Map<string, PtyHandle>()
  private dataCb: (id: string, data: string) => void = () => {}
  private exitCb: (id: string, code: number) => void = () => {}

  constructor(private spawn: PtySpawner) {}

  onData(cb: (id: string, data: string) => void): void { this.dataCb = cb }
  onExit(cb: (id: string, code: number) => void): void { this.exitCb = cb }

  create(opts: PtyCreateOptions): void {
    if (this.handles.has(opts.id)) return
    const handle = this.spawn({ shell: opts.shell, cwd: opts.cwd, cols: opts.cols, rows: opts.rows })
    handle.onData((data) => this.dataCb(opts.id, data))
    handle.onExit((code) => { this.exitCb(opts.id, code); this.handles.delete(opts.id) })
    this.handles.set(opts.id, handle)
    if (opts.startupCommand && opts.startupCommand.trim()) {
      handle.write(opts.startupCommand + '\r')
    }
  }

  write(id: string, data: string): void { this.handles.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number): void { this.handles.get(id)?.resize(cols, rows) }
  kill(id: string): void {
    const h = this.handles.get(id)
    if (h) { h.kill(); this.handles.delete(id) }
  }
  has(id: string): boolean { return this.handles.has(id) }

  snapshotProcesses(): { id: string; process: string }[] {
    return Array.from(this.handles.entries()).map(([id, h]) => ({ id, process: h.processName() }))
  }
}

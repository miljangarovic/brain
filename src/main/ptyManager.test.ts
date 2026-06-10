import { describe, it, expect, vi } from 'vitest'
import { PtyManager } from './ptyManager'
import type { PtySpawner, PtyHandle } from '@shared/pty'

function makeFake() {
  const created: any[] = []
  const spawner: PtySpawner = (opts) => {
    let dataCb = (_d: string) => {}
    let exitCb = (_c: number) => {}
    const handle: PtyHandle & { opts: any; written: string[]; resized: any; killed: boolean; emitData: (d: string) => void; emitExit: (c: number) => void } = {
      opts, written: [], resized: null, killed: false,
      write: (d) => handle.written.push(d),
      resize: (c, r) => { handle.resized = { c, r } },
      kill: () => { handle.killed = true },
      onData: (cb) => { dataCb = cb },
      onExit: (cb) => { exitCb = cb },
      processName: () => 'bash',
      emitData: (d) => dataCb(d),
      emitExit: (c) => exitCb(c)
    }
    created.push(handle)
    return handle
  }
  return { spawner, created }
}

describe('PtyManager', () => {
  it('creates one handle per id and passes spawn options', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '/tmp', shell: '/bin/bash', cols: 80, rows: 24 })
    expect(created).toHaveLength(1)
    expect(created[0].opts).toMatchObject({ cwd: '/tmp', shell: '/bin/bash', cols: 80, rows: 24 })
  })

  it('ignores a duplicate create for the same id', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    expect(created).toHaveLength(1)
  })

  it('writes the startup command followed by CR', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24, startupCommand: 'claude' })
    expect(created[0].written).toEqual(['claude\r'])
  })

  it('forwards data events with the terminal id', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    const onData = vi.fn()
    m.onData(onData)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    created[0].emitData('hello')
    expect(onData).toHaveBeenCalledWith('t1', 'hello')
  })

  it('write/resize/kill route to the right handle', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    m.write('t1', 'ls\n')
    m.resize('t1', 100, 40)
    m.kill('t1')
    expect(created[0].written).toContain('ls\n')
    expect(created[0].resized).toEqual({ c: 100, r: 40 })
    expect(created[0].killed).toBe(true)
    expect(m.has('t1')).toBe(false)
  })

  it('removes the handle on exit and emits exit', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    const onExit = vi.fn()
    m.onExit(onExit)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    created[0].emitExit(0)
    expect(onExit).toHaveBeenCalledWith('t1', 0)
    expect(m.has('t1')).toBe(false)
  })

  it('write/resize/kill on an unknown id are safe no-ops', () => {
    const { spawner } = makeFake()
    const m = new PtyManager(spawner)
    expect(() => {
      m.write('ghost', 'x')
      m.resize('ghost', 10, 10)
      m.kill('ghost')
    }).not.toThrow()
  })

  it('surfaces a spawner throw as data + exit instead of crashing', () => {
    const spawner: PtySpawner = () => { throw new Error('forkpty(3) failed.') }
    const m = new PtyManager(spawner)
    const onData = vi.fn()
    const onExit = vi.fn()
    m.onData(onData)
    m.onExit(onExit)
    expect(() => m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })).not.toThrow()
    expect(onData).toHaveBeenCalledWith('t1', expect.stringContaining('forkpty(3) failed.'))
    expect(onExit).toHaveBeenCalledWith('t1', expect.any(Number))
    expect(m.has('t1')).toBe(false)
  })

  it('a failed create can be retried with the same id', () => {
    let fail = true
    const { spawner, created } = makeFake()
    const flaky: PtySpawner = (opts) => {
      if (fail) { fail = false; throw new Error('Cannot create process') }
      return spawner(opts)
    }
    const m = new PtyManager(flaky)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    expect(m.has('t1')).toBe(false)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    expect(m.has('t1')).toBe(true)
    expect(created).toHaveLength(1)
  })

  it('snapshotProcesses lists the foreground process per live terminal', () => {
    const { spawner } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    m.create({ id: 't2', cwd: '', shell: '', cols: 80, rows: 24 })
    expect(m.snapshotProcesses()).toEqual([
      { id: 't1', process: 'bash' },
      { id: 't2', process: 'bash' }
    ])
  })
})

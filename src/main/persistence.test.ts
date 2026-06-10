import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadWorkspace, writeWorkspace, createDebouncedSaver } from './persistence'
import { createWorkspace, Workspace } from '@shared/types'

const tmpFile = () => join(tmpdir(), `orchestrix-test-${Math.random().toString(36).slice(2)}.json`)

const wsWithId = (id: string): Workspace => ({ groups: [{ id, name: id, cwd: '', collapsed: false, features: [] }] })

const exists = (p: string) => fs.access(p).then(() => true, () => false)

const rmAll = (path: string) =>
  Promise.all([path, path + '.tmp', path + '.bak', path + '.corrupt'].map((p) => fs.rm(p, { force: true })))

// Let promise chains advance between fake-timer steps.
const ticks = async (n: number) => { for (let i = 0; i < n; i++) await Promise.resolve() }

describe('persistence', () => {
  it('write then load round-trips a workspace', async () => {
    const path = tmpFile()
    const ws = { groups: [{ id: 'g', name: 'G', cwd: '', collapsed: false, features: [] }] }
    await writeWorkspace(path, ws)
    expect(await loadWorkspace(path)).toEqual(ws)
    await fs.rm(path, { force: true })
  })

  it('load returns empty workspace when file is missing', async () => {
    expect(await loadWorkspace(tmpFile())).toEqual(createWorkspace())
  })

  it('load returns empty workspace when file is corrupt', async () => {
    const path = tmpFile()
    await fs.writeFile(path, 'not json', 'utf8')
    expect(await loadWorkspace(path)).toEqual(createWorkspace())
    await rmAll(path)
  })

  it('keeps the previous version as .bak and leaves no .tmp behind', async () => {
    const path = tmpFile()
    await writeWorkspace(path, wsWithId('old'))
    await writeWorkspace(path, wsWithId('new'))
    expect(JSON.parse(await fs.readFile(path + '.bak', 'utf8'))).toEqual(wsWithId('old'))
    expect(await loadWorkspace(path)).toEqual(wsWithId('new'))
    expect(await exists(path + '.tmp')).toBe(false)
    await rmAll(path)
  })

  it('moves a corrupt file aside as .corrupt instead of leaving it to be overwritten', async () => {
    const path = tmpFile()
    await fs.writeFile(path, 'not json', 'utf8')
    await loadWorkspace(path)
    expect(await fs.readFile(path + '.corrupt', 'utf8')).toBe('not json')
    expect(await exists(path)).toBe(false)
    await rmAll(path)
  })

  it('recovers the last good version from .bak when the file is corrupt', async () => {
    const path = tmpFile()
    await writeWorkspace(path, wsWithId('good'))
    await writeWorkspace(path, wsWithId('newer'))
    await fs.writeFile(path, '{"groups": [truncated', 'utf8')
    expect(await loadWorkspace(path)).toEqual(wsWithId('good'))
    await rmAll(path)
  })

  it('treats a parseable file without a groups array as corrupt and recovers from .bak', async () => {
    const path = tmpFile()
    await writeWorkspace(path, wsWithId('good'))
    await writeWorkspace(path, wsWithId('newer'))
    await fs.writeFile(path, '{"hello": 1}', 'utf8')
    expect(await loadWorkspace(path)).toEqual(wsWithId('good'))
    expect(await exists(path + '.corrupt')).toBe(true)
    await rmAll(path)
  })

  it('does not create a .corrupt file when the workspace file is simply missing', async () => {
    const path = tmpFile()
    expect(await loadWorkspace(path)).toEqual(createWorkspace())
    expect(await exists(path + '.corrupt')).toBe(false)
  })

  describe('debounced saver', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('coalesces rapid saves into one write', async () => {
      const path = tmpFile()
      const saver = createDebouncedSaver(path, 300)
      saver.save({ groups: [{ id: '1', name: 'a', cwd: '', collapsed: false, features: [] }] })
      saver.save({ groups: [{ id: '2', name: 'b', cwd: '', collapsed: false, features: [] }] })
      vi.advanceTimersByTime(300)
      await saver.flushNow()
      const loaded = await loadWorkspace(path)
      expect(loaded.groups[0].id).toBe('2')
      await rmAll(path)
    })

    it('serializes a write that outlives the debounce window with the next one', async () => {
      const order: string[] = []
      let release!: () => void
      const gate = new Promise<void>((r) => { release = r })
      let calls = 0
      const write = async (_path: string, ws: Workspace) => {
        const n = ++calls
        order.push(`start${n}:${ws.groups[0].id}`)
        if (n === 1) await gate
        order.push(`end${n}`)
      }
      const saver = createDebouncedSaver(tmpFile(), 300, write)

      saver.save(wsWithId('1'))
      vi.advanceTimersByTime(300) // first write starts and hangs on the gate
      await ticks(5)
      saver.save(wsWithId('2'))
      vi.advanceTimersByTime(300) // second flush fires while the first write is in flight
      await ticks(5)
      expect(order).toEqual(['start1:1']) // second write must wait for the first

      release()
      await saver.flushNow()
      expect(order).toEqual(['start1:1', 'end1', 'start2:2', 'end2'])
    })

    it('loadLatest flushes the pending debounced save before reading from disk', async () => {
      const path = tmpFile()
      const saver = createDebouncedSaver(path, 300)
      saver.save(wsWithId('fresh'))
      // No timer advance: the save is still inside its debounce window.
      expect(await saver.loadLatest()).toEqual(wsWithId('fresh'))
      await rmAll(path)
    })
  })
})

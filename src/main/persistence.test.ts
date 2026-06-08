import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadWorkspace, writeWorkspace, createDebouncedSaver } from './persistence'
import { createWorkspace } from '@shared/types'

const tmpFile = () => join(tmpdir(), `orchestrix-test-${Math.random().toString(36).slice(2)}.json`)

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
    await fs.rm(path, { force: true })
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
      await fs.rm(path, { force: true })
    })
  })
})

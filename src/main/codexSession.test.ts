import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseSessionMeta, newestSessionDirs, findCodexSessionId } from './codexSession'

const mktmp = async () => {
  const dir = join(tmpdir(), `ttor-codex-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

// Write a rollout-*.jsonl with a session_meta first line under root/YYYY/MM/DD.
const writeRollout = async (root: string, day: string, id: string, cwd: string, stamp = '2026-04-27T18-31-26') => {
  const [y, m, d] = day.split('-')
  const dir = join(root, y, m, d)
  await fs.mkdir(dir, { recursive: true })
  const path = join(dir, `rollout-${stamp}-${id}.jsonl`)
  const meta = JSON.stringify({ timestamp: '2026-04-27T16:33:42.804Z', type: 'session_meta', payload: { id, cwd } })
  await fs.writeFile(path, meta + '\n{"type":"event"}\n', 'utf8')
  return path
}

describe('parseSessionMeta', () => {
  it('extracts id and cwd from a session_meta line', () => {
    const line = JSON.stringify({ type: 'session_meta', payload: { id: 'abc', cwd: '/work/app', extra: 1 } })
    expect(parseSessionMeta(line)).toEqual({ id: 'abc', cwd: '/work/app' })
  })

  it('returns null for non-meta, partial, or non-JSON lines', () => {
    expect(parseSessionMeta('{"type":"event"}')).toBeNull()
    expect(parseSessionMeta('{"type":"session_met')).toBeNull()
    expect(parseSessionMeta('')).toBeNull()
  })
})

describe('newestSessionDirs', () => {
  it('returns the most recent day directories, newest first, across month/year boundaries', async () => {
    const root = await mktmp()
    for (const day of ['2025-12-31', '2026-01-01', '2026-04-27']) {
      const [y, m, d] = day.split('-')
      await fs.mkdir(join(root, y, m, d), { recursive: true })
    }
    expect(await newestSessionDirs(root, 2)).toEqual([
      join(root, '2026', '04', '27'),
      join(root, '2026', '01', '01')
    ])
    await fs.rm(root, { recursive: true, force: true })
  })

  it('returns [] for a missing root', async () => {
    expect(await newestSessionDirs(join(tmpdir(), 'nope-xyz'))).toEqual([])
  })
})

describe('findCodexSessionId', () => {
  it('returns the newest rollout id matching the cwd', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-04-27', 'old-id', '/work/app', '2026-04-27T10-00-00')
    await new Promise((r) => setTimeout(r, 10))
    const newPath = await writeRollout(root, '2026-04-27', 'new-id', '/work/app', '2026-04-27T18-31-26')
    // bump mtime so "new-id" is unambiguously newest
    const now = Date.now()
    await fs.utimes(newPath, new Date(now), new Date(now))
    const id = await findCodexSessionId({ root, cwd: '/work/app', sinceMs: now - 60_000, claimed: new Set() })
    expect(id).toBe('new-id')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('ignores sessions from a different cwd', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-04-27', 'other', '/somewhere/else')
    const id = await findCodexSessionId({ root, cwd: '/work/app', sinceMs: 0, claimed: new Set() })
    expect(id).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('ignores already-claimed ids so concurrent captures never collide', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-04-27', 'taken', '/work/app')
    const id = await findCodexSessionId({ root, cwd: '/work/app', sinceMs: 0, claimed: new Set(['taken']) })
    expect(id).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('ignores sessions older than the launch instant', async () => {
    const root = await mktmp()
    const p = await writeRollout(root, '2026-04-27', 'stale', '/work/app')
    const old = Date.now() - 600_000
    await fs.utimes(p, new Date(old), new Date(old))
    const id = await findCodexSessionId({ root, cwd: '/work/app', sinceMs: Date.now(), claimed: new Set() })
    expect(id).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })
})

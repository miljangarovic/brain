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
// `createdIso` is the session's own (immutable) creation time, carried in the
// first-line meta; the file's mtime is set separately so tests can mimic a
// resumed session whose mtime is fresh while its createdMs stays old.
const writeRollout = async (
  root: string,
  day: string,
  id: string,
  cwd: string,
  opts: { createdIso?: string; mtimeMs?: number } = {}
) => {
  const createdIso = opts.createdIso ?? '2026-04-27T18:31:26.000Z'
  const [y, m, d] = day.split('-')
  const dir = join(root, y, m, d)
  await fs.mkdir(dir, { recursive: true })
  const stamp = createdIso.replace(/[:.]/g, '-').slice(0, 19)
  const path = join(dir, `rollout-${stamp}-${id}.jsonl`)
  const meta = JSON.stringify({ timestamp: createdIso, type: 'session_meta', payload: { id, cwd, timestamp: createdIso } })
  await fs.writeFile(path, meta + '\n{"type":"event"}\n', 'utf8')
  if (opts.mtimeMs !== undefined) await fs.utimes(path, new Date(opts.mtimeMs), new Date(opts.mtimeMs))
  return path
}

describe('parseSessionMeta', () => {
  it('extracts id, cwd and the session creation time from a session_meta line', () => {
    const line = JSON.stringify({ type: 'session_meta', payload: { id: 'abc', cwd: '/work/app', timestamp: '2026-06-09T16:23:33.000Z' } })
    expect(parseSessionMeta(line)).toEqual({ id: 'abc', cwd: '/work/app', createdMs: Date.parse('2026-06-09T16:23:33.000Z') })
  })

  it('returns null for non-meta, partial, non-JSON, or timestamp-less lines', () => {
    expect(parseSessionMeta('{"type":"event"}')).toBeNull()
    expect(parseSessionMeta('{"type":"session_met')).toBeNull()
    expect(parseSessionMeta('')).toBeNull()
    expect(parseSessionMeta(JSON.stringify({ type: 'session_meta', payload: { id: 'a', cwd: '/x' } }))).toBeNull()
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
  const launch = Date.parse('2026-06-09T16:24:37.000Z')

  it('picks the session born at/after launch for the cwd', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-06-09', 'before', '/work/app', { createdIso: '2026-06-09T16:23:33.000Z', mtimeMs: launch + 5_000 })
    await writeRollout(root, '2026-06-09', 'after', '/work/app', { createdIso: '2026-06-09T16:24:38.000Z', mtimeMs: launch + 3_000 })
    const id = await findCodexSessionId({ root, cwd: '/work/app', sinceMs: launch, claimed: new Set() })
    expect(id).toBe('after')
    await fs.rm(root, { recursive: true, force: true })
  })

  // The regression: a session created BEFORE launch but kept warm by an active
  // resume (fresh mtime) must NOT be chosen over the genuinely new session — even
  // though its mtime is newer. (codex resume appends to the original file, so its
  // mtime moves forward while session_meta.timestamp stays at the original birth.)
  it('ignores an older session whose mtime is fresh because it was just resumed', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-06-09', 'resumed-old', '/work/app', { createdIso: '2026-06-09T16:23:33.000Z', mtimeMs: launch + 30_000 })
    await writeRollout(root, '2026-06-09', 'truly-new', '/work/app', { createdIso: '2026-06-09T16:24:38.000Z', mtimeMs: launch + 5_000 })
    const id = await findCodexSessionId({ root, cwd: '/work/app', sinceMs: launch, claimed: new Set() })
    expect(id).toBe('truly-new')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('with two fresh launches in the same cwd, the earliest unclaimed session is taken', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-06-09', 'first', '/work/app', { createdIso: '2026-06-09T16:24:38.000Z', mtimeMs: launch + 6_000 })
    await writeRollout(root, '2026-06-09', 'second', '/work/app', { createdIso: '2026-06-09T16:24:45.000Z', mtimeMs: launch + 9_000 })
    const claimed = new Set<string>()
    const a = await findCodexSessionId({ root, cwd: '/work/app', sinceMs: launch, claimed })
    expect(a).toBe('first'); claimed.add(a!)
    const b = await findCodexSessionId({ root, cwd: '/work/app', sinceMs: launch, claimed })
    expect(b).toBe('second')
    await fs.rm(root, { recursive: true, force: true })
  })

  it('ignores sessions from a different cwd', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-06-09', 'other', '/somewhere/else', { createdIso: '2026-06-09T16:24:38.000Z', mtimeMs: launch + 5_000 })
    expect(await findCodexSessionId({ root, cwd: '/work/app', sinceMs: launch, claimed: new Set() })).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('ignores already-claimed and explicitly-excluded ids', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-06-09', 'taken', '/work/app', { createdIso: '2026-06-09T16:24:38.000Z', mtimeMs: launch + 5_000 })
    expect(await findCodexSessionId({ root, cwd: '/work/app', sinceMs: launch, claimed: new Set(['taken']) })).toBeNull()
    expect(await findCodexSessionId({ root, cwd: '/work/app', sinceMs: launch, claimed: new Set(), excluded: new Set(['taken']) })).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('ignores sessions created before the launch instant', async () => {
    const root = await mktmp()
    await writeRollout(root, '2026-06-09', 'stale', '/work/app', { createdIso: '2026-06-09T16:00:00.000Z', mtimeMs: launch + 5_000 })
    expect(await findCodexSessionId({ root, cwd: '/work/app', sinceMs: launch, claimed: new Set() })).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })
})

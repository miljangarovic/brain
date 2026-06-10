// @vitest-environment node
import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Group } from '@shared/types'
import type { ExportManifest } from '@shared/exportTypes'
import { slugify, sessionFileName, collectAgentSessions, runExport, validateManifest, extractImportArchive } from './exportImport'

const tmpZip = () => join(tmpdir(), `brain-export-test-${Math.random().toString(36).slice(2)}.zip`)

const group: Group = {
  id: 'g1', name: 'My Proj', cwd: '/home/me/proj', collapsed: false, features: [
    { id: 'f1', name: 'Auth Flow', collapsed: false, terminals: [
      { id: 'aaaa1111-0000-0000-0000-000000000000', name: 'claude', cwd: '/home/me/proj', kind: 'claude', sessionId: 'cs-1' },
      { id: 'bbbb2222-0000-0000-0000-000000000000', name: 'codex', cwd: '/home/me/proj', kind: 'codex', sessionId: 'cx-1' },
      { id: 't-shell', name: 'shell', cwd: '/home/me/proj' },
      { id: 't-nosess', name: 'claude', cwd: '/home/me/proj', kind: 'claude' }
    ] }
  ]
}

describe('slugify / sessionFileName', () => {
  it('slugifies to lowercase ascii with dashes', () => {
    expect(slugify('Auth Flow!')).toBe('auth-flow')
    expect(slugify('***')).toBe('x')
  })
  it('names the md after feature, terminal and a short id', () => {
    expect(sessionFileName('Auth Flow', 'claude', 'aaaa1111-0000')).toBe('sessions/auth-flow-claude-aaaa.md')
  })
})

describe('collectAgentSessions', () => {
  it('collects only agent terminals that have a sessionId', () => {
    const refs = collectAgentSessions({ scope: 'group', group })
    expect(refs.map((r) => r.sessionId)).toEqual(['cs-1', 'cx-1'])
    expect(refs[0]).toMatchObject({ kind: 'claude', cwd: '/home/me/proj', featureName: 'Auth Flow', terminalName: 'claude' })
  })
  it('feature scope collects from the single feature', () => {
    const refs = collectAgentSessions({ scope: 'feature', group: { name: 'My Proj', cwd: '/home/me/proj' }, feature: group.features[0] })
    expect(refs).toHaveLength(2)
  })
})

describe('runExport', () => {
  it('writes a zip with manifest + one md per successful summary; failures become warnings', async () => {
    const out = tmpZip()
    const progress: { done: number; total: number }[] = []
    const { warnings } = await runExport({
      input: { scope: 'group', group },
      outPath: out,
      summarize: async (ref) => ref.kind === 'claude'
        ? { ok: true, markdown: '# Claude summary' }
        : { ok: false, error: 'summarization timed out' },
      onProgress: (p) => progress.push({ done: p.done, total: p.total })
    })
    expect(warnings).toEqual(['Auth Flow/codex: summarization timed out'])
    expect(progress[0]).toEqual({ done: 0, total: 2 })
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 })

    const zip = new AdmZip(out)
    const manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8')) as ExportManifest
    expect(manifest.format).toBe('brain-export')
    expect(manifest.version).toBe(1)
    expect(manifest.scope).toBe('group')
    expect((manifest.group as Group).features[0].terminals).toHaveLength(4)
    expect(manifest.sessions['aaaa1111-0000-0000-0000-000000000000']).toEqual({ kind: 'claude', file: 'sessions/auth-flow-claude-aaaa.md' })
    expect(manifest.sessions['bbbb2222-0000-0000-0000-000000000000']).toEqual({ kind: 'codex', error: 'summarization timed out' })
    expect(zip.getEntry('sessions/auth-flow-claude-aaaa.md')!.getData().toString('utf8')).toBe('# Claude summary')
    await fsp.rm(out, { force: true })
  })
})

describe('validateManifest', () => {
  const base = { format: 'brain-export', version: 1, exportedAt: 'x', sessions: {} }
  it('accepts a group manifest', () => {
    expect(validateManifest({ ...base, scope: 'group', group: { features: [] } })).not.toBeNull()
  })
  it('accepts a feature manifest', () => {
    expect(validateManifest({ ...base, scope: 'feature', group: { name: 'p', cwd: '/p' }, feature: { terminals: [] } })).not.toBeNull()
  })
  it('rejects wrong format, version, scope, or shape', () => {
    expect(validateManifest(null)).toBeNull()
    expect(validateManifest({ ...base, format: 'other', scope: 'group', group: { features: [] } })).toBeNull()
    expect(validateManifest({ ...base, version: 2, scope: 'group', group: { features: [] } })).toBeNull()
    expect(validateManifest({ ...base, scope: 'nope' })).toBeNull()
    expect(validateManifest({ ...base, scope: 'group', group: {} })).toBeNull()
    expect(validateManifest({ ...base, scope: 'feature', group: { name: 'p' }, feature: { terminals: [] } })).toBeNull()
    expect(validateManifest({ ...base, sessions: [], scope: 'group', group: { features: [] } })).toBeNull()
    expect(validateManifest({ ...base, scope: 'group', group: { features: [{ name: 'no-terminals' }] } })).toBeNull()
  })
})

describe('extractImportArchive', () => {
  const tmpDir = () => join(tmpdir(), `brain-import-test-${Math.random().toString(36).slice(2)}`)

  async function makeArchive(manifest: unknown, files: Record<string, string> = {}): Promise<string> {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'))
    for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content, 'utf8'))
    const out = tmpZip()
    await zip.writeZipPromise(out)
    return out
  }

  const manifest = {
    format: 'brain-export', version: 1, exportedAt: 'x', scope: 'group',
    group: { id: 'g', name: 'p', cwd: '/p', collapsed: false, features: [] },
    sessions: {
      t1: { kind: 'claude', file: 'sessions/auth-claude-aaaa.md' },
      t2: { kind: 'codex', file: '../evil.md' },
      t3: { kind: 'codex', file: 'sessions/gone.md' }
    }
  }

  it('extracts the manifest and well-formed session files; bad paths and missing entries degrade to errors', async () => {
    const zipPath = await makeArchive(manifest, { 'sessions/auth-claude-aaaa.md': '# md', '../evil.md': 'evil' })
    const dest = tmpDir()
    const res = await extractImportArchive(zipPath, dest)
    expect('manifest' in res).toBe(true)
    if ('manifest' in res) {
      expect(res.dir).toBe(dest)
      expect(await fsp.readFile(join(dest, 'sessions/auth-claude-aaaa.md'), 'utf8')).toBe('# md')
      expect(res.manifest.sessions.t1.file).toBe('sessions/auth-claude-aaaa.md')
      expect(res.manifest.sessions.t2).toEqual({ kind: 'codex', error: 'invalid session file path' })
      expect(res.manifest.sessions.t3).toEqual({ kind: 'codex', error: 'session file missing from archive' })
      await expect(fsp.access(join(dest, '..', 'evil.md'))).rejects.toThrow()
    }
    await fsp.rm(zipPath, { force: true })
    await fsp.rm(dest, { recursive: true, force: true })
  })

  it('a corrupt session entry degrades instead of rejecting the import', async () => {
    const m = {
      format: 'brain-export', version: 1, exportedAt: 'x', scope: 'group',
      group: { id: 'g', name: 'p', cwd: '/p', collapsed: false, features: [] },
      sessions: { t1: { kind: 'claude', file: 'sessions/auth-claude-aaaa.md' } }
    }
    const zipPath = await makeArchive(m, { 'sessions/auth-claude-aaaa.md': '# md' })
    // Break the entry's stored CRC in its LOCAL file header (signature
    // PK\x03\x04; CRC at offset 14, filename at offset 30) — adm-zip verifies
    // getData() against exactly that field and throws BAD_CRC.
    const buf = await fsp.readFile(zipPath)
    const sig = Buffer.from('PK\x03\x04', 'binary')
    const name = Buffer.from('sessions/auth-claude-aaaa.md')
    let lh = -1
    for (let i = buf.indexOf(sig); i !== -1; i = buf.indexOf(sig, i + 1)) {
      if (buf.subarray(i + 30, i + 30 + name.length).equals(name)) { lh = i; break }
    }
    expect(lh).toBeGreaterThan(-1)
    buf.writeUInt32LE((buf.readUInt32LE(lh + 14) ^ 0xffffffff) >>> 0, lh + 14)
    await fsp.writeFile(zipPath, buf)

    const dest = tmpDir()
    const res = await extractImportArchive(zipPath, dest)
    expect('manifest' in res).toBe(true)
    if ('manifest' in res) {
      expect(res.manifest.sessions.t1).toEqual({ kind: 'claude', error: 'session file could not be read from archive' })
      await expect(fsp.access(join(dest, 'sessions/auth-claude-aaaa.md'))).rejects.toThrow()
    }
    await fsp.rm(zipPath, { force: true })
    await fsp.rm(dest, { recursive: true, force: true })
  })

  it('errors on a zip without manifest.json', async () => {
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('hi'))
    const out = tmpZip()
    await zip.writeZipPromise(out)
    expect(await extractImportArchive(out, tmpDir())).toEqual({ error: 'Not a Brain export: manifest.json is missing' })
    await fsp.rm(out, { force: true })
  })

  it('errors on an invalid manifest', async () => {
    const zipPath = await makeArchive({ format: 'other' })
    expect(await extractImportArchive(zipPath, tmpDir())).toEqual({ error: 'Unsupported or invalid manifest' })
    await fsp.rm(zipPath, { force: true })
  })

  it('errors on a file that is not a zip', async () => {
    const p = join(tmpdir(), `brain-notzip-${Math.random().toString(36).slice(2)}.zip`)
    await fsp.writeFile(p, 'plain text')
    expect(await extractImportArchive(p, tmpDir())).toEqual({ error: 'Not a readable zip archive' })
    await fsp.rm(p, { force: true })
  })
})

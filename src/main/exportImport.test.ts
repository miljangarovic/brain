// @vitest-environment node
import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Group } from '@shared/types'
import type { ExportManifest } from '@shared/exportTypes'
import { slugify, sessionFileName, collectAgentSessions, runExport } from './exportImport'

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

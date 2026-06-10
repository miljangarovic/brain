import { describe, it, expect } from 'vitest'
import type { Group } from '@shared/types'
import type { ExportManifest } from '@shared/exportTypes'
import { remapCwd, collectCwdCandidates, buildImport } from './importRemap'

const counterId = () => { let n = 0; return () => `new-${++n}` }

const group: Group = {
  id: 'g1', name: 'proj', cwd: '/old/proj', collapsed: true, features: [
    { id: 'f1', name: 'auth', collapsed: false, viewMode: 'grid', gridStyle: 'rows', terminals: [
      { id: 't-claude', name: 'claude', cwd: '/old/proj', kind: 'claude', sessionId: 'dead-1' },
      { id: 't-codex', name: 'codex', cwd: '/old/proj/sub', kind: 'codex', sessionId: 'dead-2' },
      { id: 't-shell', name: 'shell', cwd: '/old/proj', startupCommand: 'npm run dev', shell: '/bin/zsh' },
      { id: 't-failed', name: 'claude2', cwd: '/old/proj', kind: 'claude', sessionId: 'dead-3' },
      { id: 't-reviewer', name: 'rev', cwd: '/old/proj', kind: 'codex', startupCommand: `codex 'Review...'`,
        review: { originTerminalId: 't-claude', phase: 'impl', round: 1, maxRounds: 3, reviewDir: '/old/reviews/x' } }
    ] }
  ]
}

const manifest: ExportManifest = {
  format: 'brain-export', version: 1, exportedAt: 'x', scope: 'group', group,
  sessions: {
    't-claude': { kind: 'claude', file: 'sessions/auth-claude-aaaa.md' },
    't-codex': { kind: 'codex', file: 'sessions/auth-codex-bbbb.md' },
    't-failed': { kind: 'claude', error: 'summarization timed out' }
  }
}

describe('remapCwd', () => {
  it('replaces the old root prefix with the new root', () => {
    expect(remapCwd('/old/proj', '/old/proj', '/new/proj')).toBe('/new/proj')
    expect(remapCwd('/old/proj/sub', '/old/proj', '/new/proj')).toBe('/new/proj/sub')
  })
  it('leaves unrelated paths and "" alone, and is a no-op without a new root', () => {
    expect(remapCwd('/elsewhere', '/old/proj', '/new/proj')).toBe('/elsewhere')
    expect(remapCwd('/old/project-x', '/old/proj', '/new/proj')).toBe('/old/project-x') // prefix is path-segment aware
    expect(remapCwd('', '/old/proj', '/new/proj')).toBe('')
    expect(remapCwd('/old/proj', '/old/proj', null)).toBe('/old/proj')
  })
})

describe('collectCwdCandidates', () => {
  it('returns the distinct remapped cwds, excluding ""', () => {
    expect(collectCwdCandidates(manifest, '/new/proj').sort()).toEqual(['/new/proj', '/new/proj/sub'])
    expect(collectCwdCandidates(manifest, null).sort()).toEqual(['/old/proj', '/old/proj/sub'])
  })
})

describe('buildImport — group scope', () => {
  const build = (exists: (p: string) => boolean, newRoot: string | null = null) =>
    buildImport({ manifest, dir: '/data/imports/abc', newRoot, exists, createId: counterId() })

  it('regenerates every id and never reuses the originals', () => {
    const out = build(() => true)
    expect(out.scope).toBe('group')
    const g = out.group!
    const ids = [g.id, ...g.features.map((f) => f.id), ...g.features.flatMap((f) => f.terminals.map((t) => t.id))]
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^new-/)
    expect(out.terminalIds).toHaveLength(5)
    expect(g.collapsed).toBe(false)
  })

  it('agent with a summary: continue command pointing into the extracted dir; claude gets a fresh pinned id, codex none', () => {
    const out = build(() => true)
    const [claude, codex] = out.group!.features[0].terminals
    expect(claude.startupCommand).toContain(`claude --session-id ${claude.sessionId} '`)
    expect(claude.startupCommand).toContain('/data/imports/abc/sessions/auth-claude-aaaa.md')
    expect(claude.sessionId).toMatch(/^new-/)
    expect(codex.startupCommand).toContain(`codex 'Read /data/imports/abc/sessions/auth-codex-bbbb.md`)
    expect(codex.sessionId).toBeUndefined()
  })

  it('agent without a summary launches fresh; the old sessionId is never carried over', () => {
    const out = build(() => true)
    const failed = out.group!.features[0].terminals[3]
    expect(failed.startupCommand).toBe(`claude --session-id ${failed.sessionId}`)
    expect(failed.sessionId).not.toBe('dead-3')
  })

  it('shells keep startupCommand and shell; reviewers lose their review link and prompt', () => {
    const out = build(() => true)
    const shell = out.group!.features[0].terminals[2]
    expect(shell.startupCommand).toBe('npm run dev')
    expect(shell.shell).toBe('/bin/zsh')
    const reviewer = out.group!.features[0].terminals[4]
    expect(reviewer.review).toBeUndefined()
    expect(reviewer.startupCommand).toBe('codex') // fresh launch, stale review prompt dropped
  })

  it('preserves feature viewMode/gridStyle and remaps cwds; dead cwds fall back to ""', () => {
    const out = build((p) => p === '/new/proj', '/new/proj')
    const f = out.group!.features[0]
    expect(f.viewMode).toBe('grid')
    expect(f.gridStyle).toBe('rows')
    expect(out.group!.cwd).toBe('/new/proj')
    expect(f.terminals[0].cwd).toBe('/new/proj')
    expect(f.terminals[1].cwd).toBe('')   // /new/proj/sub does not exist
  })

  it('a terminal exported with cwd "" stays "" and never hits the exists check', () => {
    const m: ExportManifest = {
      ...manifest,
      group: { ...group, features: [{ id: 'f1', name: 'auth', collapsed: false, terminals: [
        { id: 't-home', name: 'shell', cwd: '' }
      ] }] }
    }
    const probed: string[] = []
    const out = buildImport({
      manifest: m, dir: '/d', newRoot: '/new/proj',
      exists: (p) => { probed.push(p); return true }, createId: counterId()
    })
    expect(out.group!.features[0].terminals[0].cwd).toBe('')
    expect(probed).not.toContain('')
  })
})

describe('buildImport — feature scope', () => {
  it('returns the feature plus a fallback group built from the manifest', () => {
    const fm: ExportManifest = {
      format: 'brain-export', version: 1, exportedAt: 'x', scope: 'feature',
      group: { name: 'proj', cwd: '/old/proj' }, feature: group.features[0], sessions: manifest.sessions
    }
    const out = buildImport({ manifest: fm, dir: '/d', newRoot: null, exists: () => true, createId: counterId() })
    expect(out.scope).toBe('feature')
    expect(out.feature!.name).toBe('auth')
    expect(out.feature!.terminals).toHaveLength(5)
    expect(out.fallbackGroup).toEqual({ name: 'proj', cwd: '/old/proj' })
  })
})

describe('buildImport — archive and documents', () => {
  const withExtras: ExportManifest = {
    ...manifest,
    group: {
      ...group,
      features: [{ ...group.features[0], documents: [{ id: 'd1', name: 'spec', path: '/old/proj/docs/spec.md' }] }],
      archivedFeatures: [
        { id: 'fa', name: 'old-flow', collapsed: false, terminals: [
          { id: 't-arch', name: 'claude', cwd: '/old/proj', kind: 'claude', sessionId: 'dead-9' }
        ] }
      ]
    },
    sessions: { ...manifest.sessions, 't-arch': { kind: 'claude', file: 'sessions/old-flow-claude-cccc.md' } }
  }
  const build = (exists: (p: string) => boolean = () => true, newRoot: string | null = null) =>
    buildImport({ manifest: withExtras, dir: '/data/imports/abc', newRoot, exists, createId: counterId() })

  it('documents carry through with fresh ids and verbatim paths', () => {
    const docs = build().group!.features[0].documents!
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toMatch(/^new-/)
    expect(docs[0]).toMatchObject({ name: 'spec', path: '/old/proj/docs/spec.md' })
  })

  it('archived features import with fresh ids and continue-from-summary commands', () => {
    const g = build().group!
    expect(g.archivedFeatures).toHaveLength(1)
    const t = g.archivedFeatures![0].terminals[0]
    expect(t.id).toMatch(/^new-/)
    expect(t.sessionId).toBeDefined()
    expect(t.sessionId).not.toBe('dead-9')
    expect(t.startupCommand).toContain('/data/imports/abc/sessions/old-flow-claude-cccc.md')
  })

  it('archived terminal ids stay out of terminalIds (nothing spawn-gates them)', () => {
    const out = build()
    const archivedIds = out.group!.archivedFeatures!.flatMap((f) => f.terminals.map((t) => t.id))
    expect(out.terminalIds).toHaveLength(5) // the five ACTIVE terminals only
    for (const id of archivedIds) expect(out.terminalIds).not.toContain(id)
  })

  it('collectCwdCandidates walks archived features too', () => {
    expect(collectCwdCandidates(withExtras, '/new/proj')).toContain('/new/proj')
    const archOnly: ExportManifest = { ...withExtras, group: { ...withExtras.group, archivedFeatures: [
      { id: 'fa', name: 'x', collapsed: false, terminals: [{ id: 'ta', name: 's', cwd: '/old/proj/arch-only' }] }
    ] } }
    expect(collectCwdCandidates(archOnly, '/new/proj')).toContain('/new/proj/arch-only')
  })
})

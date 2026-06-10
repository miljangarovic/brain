import { describe, it, expect } from 'vitest'
import { migrateWorkspace } from './migrate'

describe('migrateWorkspace', () => {
  it('wraps an old group.terminals into a default "general" feature', () => {
    const old = { groups: [{ id: 'g', name: 'G', collapsed: false, terminals: [{ id: 't', name: 'x', cwd: '' }] }] }
    const ws = migrateWorkspace(old)
    const g = ws.groups[0]
    expect(g.cwd).toBe('')
    expect(g.features).toHaveLength(1)
    expect(g.features[0].name).toBe('general')
    expect(g.features[0].terminals[0].id).toBe('t')
    expect('terminals' in g).toBe(false)
  })

  it('moves an old group.viewMode onto the default feature', () => {
    const old = { groups: [{ id: 'g', name: 'G', collapsed: false, viewMode: 'grid', terminals: [] }] }
    const ws = migrateWorkspace(old)
    expect(ws.groups[0].features[0].viewMode).toBe('grid')
  })

  it('keeps a new-shape group unchanged (idempotent)', () => {
    const cur = { groups: [{ id: 'g', name: 'G', cwd: '/tmp', collapsed: false, features: [
      { id: 'f', name: 'feat', collapsed: false, terminals: [] }
    ] }] }
    const ws = migrateWorkspace(cur)
    expect(ws.groups[0].cwd).toBe('/tmp')
    expect(ws.groups[0].features[0].id).toBe('f')
  })

  it('returns an empty workspace for missing/garbage input', () => {
    expect(migrateWorkspace(null)).toEqual({ groups: [] })
    expect(migrateWorkspace({})).toEqual({ groups: [] })
    expect(migrateWorkspace({ groups: 'nope' })).toEqual({ groups: [] })
  })

  it('skips garbage group entries instead of throwing', () => {
    expect(migrateWorkspace({ groups: [null, 42, 'junk'] })).toEqual({ groups: [] })
  })

  it('skips garbage feature and terminal entries instead of throwing', () => {
    const ws = migrateWorkspace({
      groups: [{
        id: 'g', name: 'G', cwd: '', collapsed: false,
        features: [null, { id: 'f', name: 'F', collapsed: false, terminals: [null, { id: 't', name: 'T', cwd: '' }] }]
      }]
    })
    expect(ws.groups[0].features).toHaveLength(1)
    expect(ws.groups[0].features[0].terminals).toHaveLength(1)
    expect(ws.groups[0].features[0].terminals[0].id).toBe('t')
  })

  it('generates ids and default names when they are missing', () => {
    const ws = migrateWorkspace({
      groups: [{ features: [{ terminals: [{}] }] }]
    })
    const g = ws.groups[0]
    expect(typeof g.id).toBe('string')
    expect(g.id.length).toBeGreaterThan(0)
    expect(typeof g.name).toBe('string')
    const f = g.features[0]
    expect(typeof f.id).toBe('string')
    expect(f.id.length).toBeGreaterThan(0)
    const t = f.terminals[0]
    expect(typeof t.id).toBe('string')
    expect(t.id.length).toBeGreaterThan(0)
  })

  it('tolerates a feature without a terminals array', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'G', features: [{ id: 'f', name: 'F' }] }] })
    expect(ws.groups[0].features[0].terminals).toEqual([])
  })

  it('strips legacy (reviewKind-shaped) review links but keeps new ones', () => {
    const ws = migrateWorkspace({
      groups: [{
        id: 'g', name: 'G', collapsed: false, cwd: '', features: [{
          id: 'f', name: 'general', collapsed: false, terminals: [
            { id: 'a', name: 'A', cwd: '', review: { originTerminalId: 'x', reviewKind: 'spec', reviewDir: '/r', round: 1 } },
            { id: 'b', name: 'B', cwd: '', review: { originTerminalId: 'x', phase: 'spec', round: 1, maxRounds: 5, reviewDir: '/r' } }
          ]
        }]
      }]
    })
    const terms = ws.groups[0].features[0].terminals
    expect(terms.find((t) => t.id === 'a')?.review).toBeUndefined()
    expect(terms.find((t) => t.id === 'b')?.review?.phase).toBe('spec')
  })
})

describe('archive + documents migration', () => {
  it('sanitizes archivedFeatures like active features and drops garbage entries', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [], archivedFeatures: [
      { id: 'af', name: 'old', collapsed: false, terminals: [{ id: 't', name: 's', cwd: '' }] },
      'garbage', null
    ] }] })
    expect(ws.groups[0].archivedFeatures).toHaveLength(1)
    expect(ws.groups[0].archivedFeatures![0].name).toBe('old')
    expect(ws.groups[0].archivedFeatures![0].terminals).toHaveLength(1)
  })

  it('omits archivedFeatures when absent or empty after sanitizing', () => {
    expect(migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [] }] })
      .groups[0].archivedFeatures).toBeUndefined()
    expect(migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [], archivedFeatures: ['x'] }] })
      .groups[0].archivedFeatures).toBeUndefined()
  })

  it('sanitizes feature documents: fills ids/names, drops entries without a path', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [
      { id: 'f', name: 'auth', collapsed: false, terminals: [], documents: [
        { name: 'spec', path: '/docs/spec.md' },
        { path: '/docs/plan.md' },
        { name: 'no-path' },
        'garbage'
      ] }
    ] }] })
    const docs = ws.groups[0].features[0].documents!
    expect(docs).toHaveLength(2)
    expect(docs[0]).toMatchObject({ name: 'spec', path: '/docs/spec.md' })
    expect(docs[0].id).toBeTruthy()
    expect(docs[1].name).toBe('plan.md') // basename fallback
  })

  it('omits documents when the sanitized list is empty', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [
      { id: 'f', name: 'auth', collapsed: false, terminals: [], documents: ['junk'] }
    ] }] })
    expect(ws.groups[0].features[0].documents).toBeUndefined()
  })

  it('sanitizes feature files: fills ids/names, drops entries without a path, keeps valid mdView', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [
      { id: 'f', name: 'auth', collapsed: false, terminals: [], files: [
        { name: 'spec', path: '/docs/spec.md', mdView: 'raw' },
        { path: '/docs/plan.md', mdView: 'sideways' },
        { name: 'no-path' },
        'garbage'
      ] }
    ] }] })
    const files = ws.groups[0].features[0].files!
    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({ name: 'spec', path: '/docs/spec.md', mdView: 'raw' })
    expect(files[0].id).toBeTruthy()
    expect(files[1].name).toBe('plan.md')      // basename fallback
    expect(files[1].mdView).toBeUndefined()    // invalid mdView dropped
  })

  it('omits files when the sanitized list is empty', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [
      { id: 'f', name: 'auth', collapsed: false, terminals: [], files: ['junk'] }
    ] }] })
    expect(ws.groups[0].features[0].files).toBeUndefined()
  })
})

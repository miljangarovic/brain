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

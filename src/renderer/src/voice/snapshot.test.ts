import { describe, it, expect } from 'vitest'
import { buildSnapshot } from './snapshot'
import { createInitialState, addGroup, addFeature, addTerminal, hideTerminal } from '../store'

function fixture() {
  let s = createInitialState()
  s = addGroup(s, 'mappit', '/code/mappit')   // addGroup auto-creates a 'general' feature at [0]
  const gid = s.workspace.groups[0].id
  s = addFeature(s, gid, 'file-panes')        // → lands at [1]
  const fid = s.workspace.groups[0].features[1].id
  s = addTerminal(s, fid, { name: 'claude', kind: 'claude' })
  s = addTerminal(s, fid, { name: 'shell' })
  return s
}

describe('buildSnapshot', () => {
  it('maps groups → features → terminals with names, ids and kinds', () => {
    const s = fixture()
    const snap = buildSnapshot(s)
    expect(snap.groups).toHaveLength(1)
    expect(snap.groups[0].name).toBe('mappit')
    const f = snap.groups[0].features[1]
    expect(f.name).toBe('file-panes')
    expect(f.terminals.map((t) => t.kind)).toEqual(['claude', 'shell'])
    expect(f.terminals.every((t) => typeof t.id === 'string' && t.id.length > 0)).toBe(true)
  })
  it('carries active ids', () => {
    const s = fixture()
    const snap = buildSnapshot(s)
    expect(snap.activeFeatureId).toBe(s.activeFeatureId)
    expect(snap.activeTerminalId).toBe(s.activeTerminalId)
  })
  it('flags hidden terminals (and only them)', () => {
    let s = fixture()
    const tid = s.workspace.groups[0].features[1].terminals[1].id
    s = hideTerminal(s, tid)
    const terms = buildSnapshot(s).groups[0].features[1].terminals
    expect(terms.find((t) => t.id === tid)?.hidden).toBe(true)
    expect(terms.find((t) => t.id !== tid)?.hidden).toBeUndefined()
  })
  it('nulls activeTerminalId when it is not a terminal (a file pane is selected)', () => {
    const s = { ...fixture(), activeTerminalId: 'some-file-pane-id' }
    expect(buildSnapshot(s).activeTerminalId).toBeNull()
  })
})

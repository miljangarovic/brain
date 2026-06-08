import { describe, it, expect } from 'vitest'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode,
  addTerminal, renameTerminal, removeTerminal, hideTerminal, showTerminal, isHidden,
  setActiveGroup, setActiveFeature, setActiveTerminal,
  getActiveGroup, getActiveFeature, getActiveTerminal, allTerminals
} from './store'
import { migrateWorkspace } from './migrate'

const firstGroup = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0]
const firstFeature = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0].features[0]

describe('store reducers', () => {
  it('addGroup creates a group with cwd + a default "general" feature, both active', () => {
    const s = addGroup(createInitialState(), 'proj', '/home/me/proj')
    const g = firstGroup(s)
    expect(g.name).toBe('proj')
    expect(g.cwd).toBe('/home/me/proj')
    expect(g.features).toHaveLength(1)
    expect(g.features[0].name).toBe('general')
    expect(s.activeGroupId).toBe(g.id)
    expect(s.activeFeatureId).toBe(g.features[0].id)
    expect(s.activeTerminalId).toBeNull()
  })

  it('renameGroup / toggleGroupCollapsed', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = renameGroup(s, gid, 'b')
    expect(firstGroup(s).name).toBe('b')
    s = toggleGroupCollapsed(s, gid)
    expect(firstGroup(s).collapsed).toBe(true)
  })

  it('addFeature appends a feature and activates it', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'auth')
    expect(firstGroup(s).features).toHaveLength(2)
    const auth = firstGroup(s).features[1]
    expect(auth.name).toBe('auth')
    expect(s.activeFeatureId).toBe(auth.id)
    expect(s.activeTerminalId).toBeNull()
  })

  it('renameFeature / toggleFeatureCollapsed / toggleFeatureViewMode', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = renameFeature(s, fid, 'core')
    expect(firstFeature(s).name).toBe('core')
    s = toggleFeatureCollapsed(s, fid)
    expect(firstFeature(s).collapsed).toBe(true)
    expect(firstFeature(s).viewMode).toBeUndefined()
    s = toggleFeatureViewMode(s, fid)
    expect(firstFeature(s).viewMode).toBe('grid')
    s = toggleFeatureViewMode(s, fid)
    expect(firstFeature(s).viewMode).toBe('tabs')
  })

  it('addTerminal puts the terminal in the feature and inherits the group cwd', () => {
    let s = addGroup(createInitialState(), 'a', '/proj')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'claude', startupCommand: 'claude', kind: 'claude' })
    const t = firstFeature(s).terminals[0]
    expect(t.name).toBe('claude')
    expect(t.cwd).toBe('/proj')
    expect(t.kind).toBe('claude')
    expect(s.activeTerminalId).toBe(t.id)
  })

  it('renameTerminal', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    const tid = firstFeature(s).terminals[0].id
    s = renameTerminal(s, tid, 'y')
    expect(firstFeature(s).terminals[0].name).toBe('y')
  })

  it('removeTerminal selects a sibling within the feature', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    const aId = firstFeature(s).terminals[0].id
    const bId = firstFeature(s).terminals[1].id
    s = setActiveTerminal(s, bId)
    s = removeTerminal(s, bId)
    expect(firstFeature(s).terminals).toHaveLength(1)
    expect(s.activeTerminalId).toBe(aId)
  })

  it('deleteFeature re-selects another feature in the group', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'second')
    const f1 = firstGroup(s).features[0].id
    const f2 = firstGroup(s).features[1].id
    s = setActiveFeature(s, f2)
    s = deleteFeature(s, f2)
    expect(firstGroup(s).features).toHaveLength(1)
    expect(s.activeFeatureId).toBe(f1)
  })

  it('deleteGroup re-selects another group', () => {
    let s = addGroup(addGroup(createInitialState(), 'g1', ''), 'g2', '')
    const g1 = s.workspace.groups[0].id
    const g2 = s.workspace.groups[1].id
    s = deleteGroup(s, g2)
    expect(s.workspace.groups).toHaveLength(1)
    expect(s.activeGroupId).toBe(g1)
  })

  it('setActiveTerminal sets the owning feature and group too', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'f2')
    const f1 = firstGroup(s).features[0].id
    s = addTerminal(s, f1, { name: 't' })
    const tid = firstGroup(s).features[0].terminals[0].id
    s = setActiveFeature(s, firstGroup(s).features[1].id)
    s = setActiveTerminal(s, tid)
    expect(s.activeFeatureId).toBe(f1)
    expect(s.activeGroupId).toBe(gid)
    expect(s.activeTerminalId).toBe(tid)
  })

  it('selectors + allTerminals', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    expect(getActiveGroup(s)?.name).toBe('a')
    expect(getActiveFeature(s)?.id).toBe(fid)
    expect(getActiveTerminal(s)?.name).toBe('x')
    expect(allTerminals(s)).toHaveLength(1)
  })

  it('createInitialState picks first group/feature/terminal from a migrated workspace', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'G', collapsed: false, terminals: [{ id: 't', name: 'x', cwd: '' }] }] })
    const s = createInitialState(ws)
    expect(s.activeGroupId).toBe('g')
    expect(s.activeFeatureId).toBe(ws.groups[0].features[0].id)
    expect(s.activeTerminalId).toBe('t')
  })

  it('hideTerminal hides it (slot kept) and moves active to a visible sibling', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    const aId = firstFeature(s).terminals[0].id
    const bId = firstFeature(s).terminals[1].id
    s = setActiveTerminal(s, bId)
    s = hideTerminal(s, bId)
    expect(isHidden(s, bId)).toBe(true)
    expect(s.workspace.groups[0].features[0].terminals).toHaveLength(2) // slot kept
    expect(s.activeTerminalId).toBe(aId)                                // moved to visible sibling
  })

  it('showTerminal un-hides it and activates it', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    const tid = firstFeature(s).terminals[0].id
    s = hideTerminal(s, tid)
    expect(isHidden(s, tid)).toBe(true)
    s = showTerminal(s, tid)
    expect(isHidden(s, tid)).toBe(false)
    expect(s.activeTerminalId).toBe(tid)
  })

  it('removeTerminal prunes the hidden set and skips hidden siblings when re-selecting', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    s = addTerminal(s, fid, { name: 'c' })
    const [aId, bId, cId] = firstFeature(s).terminals.map((t) => t.id)
    s = hideTerminal(s, bId)        // b is hidden
    s = setActiveTerminal(s, cId)
    s = removeTerminal(s, cId)      // delete active c -> must skip hidden b, pick a
    expect(s.activeTerminalId).toBe(aId)
    expect(isHidden(s, bId)).toBe(true)
    s = removeTerminal(s, bId)      // deleting b prunes it from hidden
    expect(isHidden(s, bId)).toBe(false)
  })
})

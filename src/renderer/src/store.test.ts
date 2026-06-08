import { describe, it, expect } from 'vitest'
import {
  createInitialState, addGroup, renameGroup, toggleGroupCollapsed, deleteGroup,
  addTerminal, removeTerminal, setActiveGroup, setActiveTerminal,
  getActiveGroup, getActiveTerminal, allTerminals
} from './store'

describe('store reducers', () => {
  it('addGroup adds and activates the group', () => {
    const s = addGroup(createInitialState(), 'feature-auth')
    expect(s.workspace.groups).toHaveLength(1)
    expect(s.workspace.groups[0].name).toBe('feature-auth')
    expect(s.activeGroupId).toBe(s.workspace.groups[0].id)
    expect(s.activeTerminalId).toBeNull()
  })

  it('renameGroup changes the name', () => {
    let s = addGroup(createInitialState(), 'old')
    const id = s.workspace.groups[0].id
    s = renameGroup(s, id, 'new')
    expect(s.workspace.groups[0].name).toBe('new')
  })

  it('toggleGroupCollapsed flips collapsed', () => {
    let s = addGroup(createInitialState(), 'g')
    const id = s.workspace.groups[0].id
    s = toggleGroupCollapsed(s, id)
    expect(s.workspace.groups[0].collapsed).toBe(true)
  })

  it('addTerminal appends and activates it', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'claude', cwd: '/tmp', startupCommand: 'claude' })
    const t = s.workspace.groups[0].terminals[0]
    expect(t.name).toBe('claude')
    expect(t.cwd).toBe('/tmp')
    expect(t.startupCommand).toBe('claude')
    expect(s.activeTerminalId).toBe(t.id)
  })

  it('removeTerminal selects a sibling', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'a', cwd: '' })
    s = addTerminal(s, gid, { name: 'b', cwd: '' })
    const aId = s.workspace.groups[0].terminals[0].id
    const bId = s.workspace.groups[0].terminals[1].id
    s = setActiveTerminal(s, bId)
    s = removeTerminal(s, bId)
    expect(s.workspace.groups[0].terminals).toHaveLength(1)
    expect(s.activeTerminalId).toBe(aId)
  })

  it('deleteGroup removes it and re-selects', () => {
    let s = addGroup(addGroup(createInitialState(), 'g1'), 'g2')
    const g1 = s.workspace.groups[0].id
    const g2 = s.workspace.groups[1].id
    s = deleteGroup(s, g2)
    expect(s.workspace.groups).toHaveLength(1)
    expect(s.activeGroupId).toBe(g1)
  })

  it('selectors return active entities', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'x', cwd: '' })
    expect(getActiveGroup(s)?.id).toBe(gid)
    expect(getActiveTerminal(s)?.name).toBe('x')
    expect(allTerminals(s)).toHaveLength(1)
  })

  it('createInitialState on an empty workspace has no active selection', () => {
    const s = createInitialState()
    expect(s.activeGroupId).toBeNull()
    expect(s.activeTerminalId).toBeNull()
  })

  it('removeTerminal preserves the active terminal when removing a different one', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'a', cwd: '' })
    s = addTerminal(s, gid, { name: 'b', cwd: '' })
    const aId = s.workspace.groups[0].terminals[0].id
    const bId = s.workspace.groups[0].terminals[1].id
    s = setActiveTerminal(s, aId)
    s = removeTerminal(s, bId)
    expect(s.activeTerminalId).toBe(aId)
  })

  it('deleteGroup keeps the active selection when removing a non-active group', () => {
    let s = addGroup(addGroup(createInitialState(), 'g1'), 'g2')
    const g1 = s.workspace.groups[0].id
    const g2 = s.workspace.groups[1].id
    s = setActiveGroup(s, g1)
    s = deleteGroup(s, g2)
    expect(s.activeGroupId).toBe(g1)
  })

  it('addTerminal trims and drops blank startup command / shell', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'x', cwd: '', startupCommand: '  claude  ', shell: '   ' })
    const t = s.workspace.groups[0].terminals[0]
    expect(t.startupCommand).toBe('claude')
    expect(t.shell).toBeUndefined()
  })

  it('setActiveTerminal also activates the owning group', () => {
    let s = addGroup(addGroup(createInitialState(), 'g1'), 'g2')
    const g1 = s.workspace.groups[0].id
    s = addTerminal(s, g1, { name: 'a', cwd: '' })
    const aId = s.workspace.groups[0].terminals[0].id
    s = setActiveGroup(s, s.workspace.groups[1].id) // make g2 active
    s = setActiveTerminal(s, aId)
    expect(s.activeGroupId).toBe(g1)
    expect(s.activeTerminalId).toBe(aId)
  })
})

import { describe, it, expect } from 'vitest'
import { planCommand } from './executor'
import {
  createInitialState, addGroup, addFeature, addTerminal, hideTerminal,
  toggleFeatureViewMode
} from '../store'
import type { VoiceCommand } from '@shared/voice'

function fixture() {
  let s = createInitialState()
  s = addGroup(s, 'mappit', '/code/mappit')   // addGroup auto-creates a 'general' feature at [0]
  const gid = s.workspace.groups[0].id
  s = addFeature(s, gid, 'file-panes')        // → [1]
  s = addFeature(s, gid, 'voice')             // → [2]
  const f1 = s.workspace.groups[0].features[1]
  const f2 = s.workspace.groups[0].features[2]
  s = addTerminal(s, f1.id, { name: 'claude', kind: 'claude' })
  s = addTerminal(s, f1.id, { name: 'shell' })
  return { s, f1: f1.id, f2: f2.id, t1: s.workspace.groups[0].features[1].terminals[0].id, t2: s.workspace.groups[0].features[1].terminals[1].id }
}
const cmd = (c: Partial<VoiceCommand> & { action: VoiceCommand['action'] }): VoiceCommand =>
  ({ confidence: 'high', ...c })

describe('planCommand — immediate actions', () => {
  it('switch_feature → run setActiveFeature, startIds = first visible terminal', () => {
    const { s, f1, t1 } = fixture()
    const p = planCommand(cmd({ action: 'switch_feature', featureId: f1 }), s)
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    expect(p.descriptor.startIds).toEqual([t1])
    expect(p.descriptor.run(s).activeFeatureId).toBe(f1)
    expect(p.descriptor.toast).toContain('file-panes')
  })
  it('toggle_grid defaults to the active feature and notes restored hidden terminals', () => {
    let { s, t2 } = fixture()
    s = hideTerminal(s, t2)
    const p = planCommand(cmd({ action: 'toggle_grid' }), s)
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.toast).toContain('restored')
    const after = p.descriptor.run(s)
    expect(after.workspace.groups[0].features[1].viewMode).toBe('grid')
  })
  it('toggle_grid leaving grid has no restored note', () => {
    let { s, f1 } = fixture()
    s = toggleFeatureViewMode(s, f1) // now grid
    const p = planCommand(cmd({ action: 'toggle_grid', featureId: f1 }), s)
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.toast).not.toContain('restored')
  })
  it('switch_tab on a hidden terminal un-hides it (showTerminal)', () => {
    let { s, t2 } = fixture()
    s = hideTerminal(s, t2)
    const p = planCommand(cmd({ action: 'switch_tab', terminalId: t2 }), s)
    if (p.type !== 'run') throw new Error('expected run')
    const after = p.descriptor.run(s)
    expect(after.hidden).not.toContain(t2)
    expect(after.activeTerminalId).toBe(t2)
    expect(p.descriptor.startIds).toEqual([t2])
  })
  it('set_grid_style requires a gridStyle', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'set_grid_style' }), s).type).toBe('error')
    const p = planCommand(cmd({ action: 'set_grid_style', gridStyle: 'cols' }), s)
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.run(s).workspace.groups[0].features[1].gridStyle).toBe('cols')
  })
  it('hide_terminal defaults to the active terminal', () => {
    const { s, t2 } = fixture() // addTerminal activates the last-added → t2 active
    const p = planCommand(cmd({ action: 'hide_terminal' }), s)
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.run(s).hidden).toContain(t2)
  })
})

describe('planCommand — confirm actions', () => {
  it('add_terminal defaults kind=claude, feature=active, carries the prompt editable', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'add_terminal', prompt: 'sredi testove' }), s)
    if (p.type !== 'confirm') throw new Error('expected confirm')
    expect(p.editablePrompt).toBe('sredi testove')
    expect(p.descriptor).toMatchObject({ type: 'addTerminal', featureId: f1, kind: 'claude', prompt: 'sredi testove' })
  })
  it('close_terminal → confirm with closeTerminal descriptor', () => {
    const { s, t2 } = fixture()
    const p = planCommand(cmd({ action: 'close_terminal', terminalId: t2 }), s)
    if (p.type !== 'confirm') throw new Error('expected confirm')
    expect(p.descriptor).toEqual({ type: 'closeTerminal', terminalId: t2 })
    expect(p.summary).toContain('shell')
  })
  it('rename_feature → confirm with a pure state descriptor', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'rename_feature', featureId: f1, name: 'panes-v2' }), s)
    if (p.type !== 'confirm') throw new Error('expected confirm')
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.run(s).workspace.groups[0].features[1].name).toBe('panes-v2')
  })
  it('rename_terminal without a name → error', () => {
    const { s, t1 } = fixture()
    expect(planCommand(cmd({ action: 'rename_terminal', terminalId: t1 }), s).type).toBe('error')
  })
  it('low confidence downgrades an immediate action to confirm', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'switch_feature', featureId: f1, confidence: 'low' }), s)
    expect(p.type).toBe('confirm')
  })
})

describe('planCommand — invalid input', () => {
  it('unknown → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'unknown' }), s).type).toBe('error')
  })
  it('stale/wrong ids → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'switch_feature', featureId: 'gone' }), s).type).toBe('error')
    expect(planCommand(cmd({ action: 'switch_tab', terminalId: 'gone' }), s).type).toBe('error')
  })
  it('switch_feature without featureId → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'switch_feature' }), s).type).toBe('error')
  })
})

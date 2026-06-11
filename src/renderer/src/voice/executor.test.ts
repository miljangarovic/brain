import { describe, it, expect } from 'vitest'
import { planCommand } from './executor'
import {
  createInitialState, addGroup, addFeature, addTerminal, hideTerminal,
  toggleFeatureViewMode, setActiveTerminal, openFile, setActiveFeature
} from '../store'
import type { VoiceCommand } from '@shared/voice'
import type { AgentKind } from '../agents'
import type { ReviewStatus } from '@shared/types'

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

const ctx = (
  liveAgents: Record<string, AgentKind | undefined> = {},
  reviewStatus: Record<string, ReviewStatus | undefined> = {}
) => ({ liveAgents, reviewStatus })

describe('planCommand — immediate actions', () => {
  it('switch_feature → run setActiveFeature, startIds = first visible terminal', () => {
    const { s, f1, t1 } = fixture()
    const p = planCommand(cmd({ action: 'switch_feature', featureId: f1 }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.startIds).toEqual([t1])
    expect(p.descriptor.run(s).activeFeatureId).toBe(f1)
    expect(p.descriptor.toast).toContain('file-panes')
  })
  it('switch_feature onto a feature whose only terminal is hidden → plan is run, no startIds', () => {
    let { s, f1, t1 } = fixture()
    s = hideTerminal(s, t1)
    // hide the second terminal too so f1 has no visible terminals
    s = hideTerminal(s, s.workspace.groups[0].features[1].terminals[1].id)
    const p = planCommand(cmd({ action: 'switch_feature', featureId: f1 }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.startIds).toBeUndefined()
    expect(p.descriptor.run(s).activeFeatureId).toBe(f1)
  })
  it('toggle_grid defaults to the active feature and notes restored hidden terminals', () => {
    let { s, t2 } = fixture()
    s = hideTerminal(s, t2)
    const p = planCommand(cmd({ action: 'toggle_grid' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run')
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.toast).toContain('restored')
    const after = p.descriptor.run(s)
    expect(after.workspace.groups[0].features[1].viewMode).toBe('grid')
  })
  it('toggle_grid leaving grid has no restored note', () => {
    let { s, f1 } = fixture()
    s = toggleFeatureViewMode(s, f1) // now grid
    const p = planCommand(cmd({ action: 'toggle_grid', featureId: f1 }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.toast).not.toContain('restored')
  })
  it('switch_tab on a hidden terminal un-hides it (showTerminal)', () => {
    let { s, t2 } = fixture()
    s = hideTerminal(s, t2)
    const p = planCommand(cmd({ action: 'switch_tab', terminalId: t2 }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run')
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    const after = p.descriptor.run(s)
    expect(after.hidden).not.toContain(t2)
    expect(after.activeTerminalId).toBe(t2)
    expect(p.descriptor.startIds).toEqual([t2])
  })
  it('set_grid_style requires a gridStyle', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'set_grid_style' }), s, ctx()).type).toBe('error')
    const p = planCommand(cmd({ action: 'set_grid_style', gridStyle: 'cols' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run')
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.run(s).workspace.groups[0].features[1].gridStyle).toBe('cols')
  })
  it('hide_terminal defaults to the active terminal', () => {
    const { s, t2 } = fixture() // addTerminal activates the last-added → t2 active
    const p = planCommand(cmd({ action: 'hide_terminal' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run')
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.run(s).hidden).toContain(t2)
  })
})

describe('planCommand — confirm actions', () => {
  it('add_terminal defaults kind=claude, feature=active, carries the prompt editable', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'add_terminal', prompt: 'sredi testove' }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm')
    expect(p.editablePrompt).toBe('sredi testove')
    expect(p.descriptor).toMatchObject({ type: 'addTerminal', featureId: f1, kind: 'claude', prompt: 'sredi testove' })
  })
  it('close_terminal → confirm with closeTerminal descriptor', () => {
    const { s, t2 } = fixture()
    const p = planCommand(cmd({ action: 'close_terminal', terminalId: t2 }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm')
    expect(p.descriptor).toEqual({ type: 'closeTerminal', terminalId: t2 })
    expect(p.summary).toContain('shell')
  })
  it('rename_feature → confirm with a pure state descriptor', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'rename_feature', featureId: f1, name: 'panes-v2' }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm')
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.run(s).workspace.groups[0].features[1].name).toBe('panes-v2')
  })
  it('rename_terminal without a name → error', () => {
    const { s, t1 } = fixture()
    expect(planCommand(cmd({ action: 'rename_terminal', terminalId: t1 }), s, ctx()).type).toBe('error')
  })
  it('low confidence downgrades an immediate action to confirm', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'switch_feature', featureId: f1, confidence: 'low' }), s, ctx())
    expect(p.type).toBe('confirm')
  })
})

describe('planCommand — invalid input', () => {
  it('unknown → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'unknown' }), s, ctx()).type).toBe('error')
  })
  it('stale/wrong ids → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'switch_feature', featureId: 'gone' }), s, ctx()).type).toBe('error')
    expect(planCommand(cmd({ action: 'switch_tab', terminalId: 'gone' }), s, ctx()).type).toBe('error')
  })
  it('switch_feature without featureId → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'switch_feature' }), s, ctx()).type).toBe('error')
  })
})

describe('planCommand — send_prompt', () => {
  it('live claude target → confirm with editable prompt and sendPrompt descriptor', () => {
    const { s, t1 } = fixture()
    const p = planCommand(cmd({ action: 'send_prompt', terminalId: t1, prompt: 'sredi testove' }), s, ctx({ [t1]: 'claude' }))
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    expect(p.editablePrompt).toBe('sredi testove')
    expect(p.summary).toContain('Send to "claude"')
    expect(p.descriptor).toEqual({ type: 'sendPrompt', terminalId: t1, prompt: 'sredi testove' })
  })
  it('cold (not running) agent → error pointing at add_terminal', () => {
    const { s, t1 } = fixture()
    const p = planCommand(cmd({ action: 'send_prompt', terminalId: t1, prompt: 'x' }), s, ctx())
    if (p.type !== 'error') throw new Error('expected error')
    expect(p.message).toMatch(/not running/)
  })
  it('shell target → error', () => {
    const { s, t2 } = fixture()
    const p = planCommand(cmd({ action: 'send_prompt', terminalId: t2, prompt: 'x' }), s, ctx())
    if (p.type !== 'error') throw new Error('expected error')
    expect(p.message).toMatch(/claude\/codex/)
  })
  it('missing prompt → error', () => {
    const { s, t1 } = fixture()
    const p = planCommand(cmd({ action: 'send_prompt', terminalId: t1 }), s, ctx({ [t1]: 'claude' }))
    if (p.type !== 'error') throw new Error('expected error')
    // Message asserted so this test FAILS against Task 1's placeholder case
    // ("Didn't understand the command") and only passes with the real case.
    expect(p.message).toMatch(/No prompt/)
  })
  it('defaults to the active terminal', () => {
    let { s, t1 } = fixture()
    s = setActiveTerminal(s, t1)
    const p = planCommand(cmd({ action: 'send_prompt', prompt: 'nastavi' }), s, ctx({ [t1]: 'claude' }))
    if (p.type !== 'confirm') throw new Error('expected confirm')
    if (p.descriptor.type !== 'sendPrompt') throw new Error('expected sendPrompt descriptor')
    expect(p.descriptor.terminalId).toBe(t1)
  })
})

describe('planCommand — review control', () => {
  function reviewFixture() {
    const base = fixture()
    const s = addTerminal(base.s, base.f1, {
      name: 'review: claude', kind: 'claude',
      review: { originTerminalId: base.t1, phase: 'impl', round: 1, maxRounds: 3, reviewDir: '/tmp/r' }
    })
    const reviewerId = s.workspace.groups[0].features[1].terminals[2].id
    return { ...base, s, reviewerId }
  }
  it('review_accept runs only at needs-decision', () => {
    const { s, reviewerId } = reviewFixture()
    expect(planCommand(cmd({ action: 'review_accept' }), s, ctx({}, { [reviewerId]: 'reviewing' })).type).toBe('error')
    const p = planCommand(cmd({ action: 'review_accept' }), s, ctx({}, { [reviewerId]: 'needs-decision' }))
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    expect(p.descriptor).toMatchObject({ type: 'review', op: 'accept', reviewerId })
    expect(p.descriptor.toast).toContain('file-panes')
  })
  it('review_more_rounds runs only at needs-decision', () => {
    const { s, reviewerId } = reviewFixture()
    expect(planCommand(cmd({ action: 'review_more_rounds' }), s, ctx({}, { [reviewerId]: 'reviewing' })).type).toBe('error')
    const p = planCommand(cmd({ action: 'review_more_rounds' }), s, ctx({}, { [reviewerId]: 'needs-decision' }))
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    expect(p.descriptor).toMatchObject({ type: 'review', op: 'more-rounds', reviewerId })
  })
  it('review_stop → confirm with a review descriptor', () => {
    const { s, reviewerId } = reviewFixture()
    const p = planCommand(cmd({ action: 'review_stop' }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    expect(p.descriptor).toMatchObject({ type: 'review', op: 'stop', reviewerId })
    expect(p.summary).toContain('file-panes')
  })
  it('review actions in a feature without a reviewer → error', () => {
    const { s, f2 } = fixture()
    expect(planCommand(cmd({ action: 'review_accept', featureId: f2 }), s, ctx()).type).toBe('error')
    expect(planCommand(cmd({ action: 'review_stop', featureId: f2 }), s, ctx()).type).toBe('error')
  })
})

describe('planCommand — feature lifecycle', () => {
  it('add_feature → confirm; run appends and activates the feature in the named project', () => {
    const { s } = fixture()
    const gid = s.workspace.groups[0].id
    const p = planCommand(cmd({ action: 'add_feature', groupId: gid, name: 'search' }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.summary).toContain('search')
    expect(p.summary).toContain('mappit')
    const after = p.descriptor.run(s)
    expect(after.workspace.groups[0].features.map((f) => f.name)).toContain('search')
    expect(after.activeFeatureId).toBe(after.workspace.groups[0].features.at(-1)!.id)
  })
  it('add_feature defaults to the active project and requires a name', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'add_feature' }), s, ctx()).type).toBe('error')
    expect(planCommand(cmd({ action: 'add_feature', name: 'search' }), s, ctx()).type).toBe('confirm')
  })
  it('archive_feature → confirm; run moves the feature to the group archive', () => {
    const { s, f2 } = fixture()
    const p = planCommand(cmd({ action: 'archive_feature', featureId: f2 }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.summary).toContain('voice')
    const after = p.descriptor.run(s)
    expect(after.workspace.groups[0].features.map((f) => f.id)).not.toContain(f2)
    expect((after.workspace.groups[0].archivedFeatures ?? []).map((f) => f.id)).toContain(f2)
  })
  it('archive_feature defaults to the active feature', () => {
    const { s } = fixture() // f1 ('file-panes') is active
    const p = planCommand(cmd({ action: 'archive_feature' }), s, ctx())
    if (p.type !== 'confirm') throw new Error('expected confirm, got ' + p.type)
    expect(p.summary).toContain('file-panes')
  })
})

describe('planCommand — tab actions', () => {
  it('cycle_tab next moves to the following terminal with startIds', () => {
    let { s, t1, t2 } = fixture()
    s = setActiveTerminal(s, t1)
    const p = planCommand(cmd({ action: 'cycle_tab', direction: 'next' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.startIds).toEqual([t2])
    expect(p.descriptor.run(s).activeTerminalId).toBe(t2)
  })
  it('cycle_tab lands on a file pane without startIds (direction defaults to next)', () => {
    let { s, f1, t2 } = fixture()
    s = openFile(s, f1, { path: '/code/readme.md' })
    s = setActiveTerminal(s, t2)
    const p = planCommand(cmd({ action: 'cycle_tab' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.startIds).toBeUndefined()
    expect(p.descriptor.run(s).activeTerminalId).toBe(s.workspace.groups[0].features[1].files![0].id)
  })
  it('cycle_tab with no visible panes → error', () => {
    let { s, f2 } = fixture()
    s = setActiveFeature(s, f2) // 'voice' has no terminals
    expect(planCommand(cmd({ action: 'cycle_tab', direction: 'next' }), s, ctx()).type).toBe('error')
  })
  it('close_tabs others keeps the active tab, hides terminals and closes file panes', () => {
    let { s, f1, t1, t2 } = fixture()
    s = openFile(s, f1, { path: '/code/readme.md' })
    s = setActiveTerminal(s, t1)
    const p = planCommand(cmd({ action: 'close_tabs', scope: 'others' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    const after = p.descriptor.run(s)
    expect(after.hidden).toContain(t2)
    expect(after.hidden).not.toContain(t1)
    expect(after.workspace.groups[0].features[1].files).toEqual([])
    expect(after.activeTerminalId).toBe(t1)
    expect(p.descriptor.toast).toContain('2')
  })
  it('close_tabs right hides only tabs after the active one', () => {
    let { s, t1, t2 } = fixture()
    s = setActiveTerminal(s, t1)
    const p = planCommand(cmd({ action: 'close_tabs', scope: 'right' }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.run(s).hidden).toEqual([t2])
  })
  it('close_tabs with a NAMED terminal keeps it, hides the rest, activates it', () => {
    const { s, t1, t2 } = fixture() // active = t2 (last added)
    const p = planCommand(cmd({ action: 'close_tabs', terminalId: t1 }), s, ctx())
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    const after = p.descriptor.run(s)
    expect(after.hidden).toEqual([t2])
    expect(after.activeTerminalId).toBe(t1)
    expect(p.descriptor.startIds).toEqual([t1])
  })
  it('close_tabs with nothing to close → error', () => {
    let { s, t1 } = fixture()
    s = setActiveTerminal(s, t1)
    expect(planCommand(cmd({ action: 'close_tabs', scope: 'left' }), s, ctx()).type).toBe('error')
  })
})

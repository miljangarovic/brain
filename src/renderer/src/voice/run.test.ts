import { describe, it, expect, vi } from 'vitest'
import { runDescriptor } from './run'
import { createInitialState, addGroup, addTerminal, type AppState } from '../store'

function fixture(withReviewer = false) {
  let s = createInitialState()
  s = addGroup(s, 'p', '/p')
  // addGroup auto-creates a 'general' feature — use it directly.
  const fid = s.workspace.groups[0].features[0].id
  s = addTerminal(s, fid, { name: 'origin', kind: 'claude' })
  const originId = s.workspace.groups[0].features[0].terminals[0].id
  if (withReviewer) {
    s = addTerminal(s, fid, {
      name: 'reviewer', kind: 'claude',
      review: { originTerminalId: originId, phase: 'impl', round: 1, maxRounds: 3, reviewDir: '/tmp/r' }
    })
  }
  const ids = s.workspace.groups[0].features[0].terminals.map((t) => t.id)
  return { s, fid, ids }
}

const deps = (s: AppState) => ({
  state: s,
  apply: vi.fn(),
  markStarted: vi.fn(),
  stopReviewLoop: vi.fn(),
  launchAgent: vi.fn(),
  sendPrompt: vi.fn()
})

describe('runDescriptor', () => {
  it('state: marks startIds then applies', () => {
    const { s } = fixture()
    const d = deps(s)
    const run = (st: AppState) => st
    runDescriptor({ type: 'state', run, toast: 'x', startIds: ['a', 'b'] }, d)
    expect(d.markStarted.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(d.apply).toHaveBeenCalledWith(run)
  })
  it('closeTerminal on a REVIEWER terminal → stopReviewLoop, never removeTerminal', () => {
    const { s, ids } = fixture(true)
    const d = deps(s)
    runDescriptor({ type: 'closeTerminal', terminalId: ids[1] }, d)
    expect(d.stopReviewLoop).toHaveBeenCalledWith(ids[1])
    expect(d.apply).not.toHaveBeenCalled()
  })
  it('closeTerminal on a plain terminal → apply(removeTerminal)', () => {
    const { s, ids } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'closeTerminal', terminalId: ids[0] }, d)
    expect(d.stopReviewLoop).not.toHaveBeenCalled()
    expect(d.apply).toHaveBeenCalledTimes(1)
    const fn = d.apply.mock.calls[0][0] as (st: AppState) => AppState
    const after = fn(s)
    expect(after.workspace.groups[0].features[0].terminals.map((t) => t.id)).not.toContain(ids[0])
  })
  it('addTerminal agent kind → launchAgent with prompt/name', () => {
    const { s, fid } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'addTerminal', featureId: fid, kind: 'claude', prompt: 'sredi testove' }, d)
    expect(d.launchAgent).toHaveBeenCalledWith(fid, 'claude', { prompt: 'sredi testove' })
    expect(d.apply).not.toHaveBeenCalled()
  })
  it('addTerminal shell kind → apply(addTerminal) with the prompt as startupCommand', () => {
    const { s, fid } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'addTerminal', featureId: fid, kind: 'shell', prompt: 'npm test' }, d)
    expect(d.launchAgent).not.toHaveBeenCalled()
    const fn = d.apply.mock.calls[0][0] as (st: AppState) => AppState
    const after = fn(s)
    const added = after.workspace.groups[0].features[0].terminals.at(-1)
    expect(added?.startupCommand).toBe('npm test')
    expect(added?.name).toBe('shell')
  })
  it('sendPrompt descriptor delegates to deps.sendPrompt only', () => {
    const { s } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'sendPrompt', terminalId: 'tx', prompt: 'sredi testove' }, d)
    expect(d.sendPrompt).toHaveBeenCalledWith('tx', 'sredi testove')
    expect(d.apply).not.toHaveBeenCalled()
    expect(d.launchAgent).not.toHaveBeenCalled()
  })
})

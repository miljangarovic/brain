// src/renderer/src/attention/decide.test.ts
import { describe, it, expect } from 'vitest'
import { decideOnIdle, decideOnExit, outputSpanMs, MIN_WORK_MS } from './decide'

describe('outputSpanMs', () => {
  it('measures output duration, excluding the trailing idle window', () => {
    // busy at t=1000, idle emitted at t=2700 with a 1500ms quiet window:
    // the agent actually produced output for ~200ms — a redraw blip.
    expect(outputSpanMs(1000, 2700, 1500)).toBe(200)
  })
  it('is zero when no busy start was observed', () => {
    expect(outputSpanMs(undefined, 5000, 1500)).toBe(0)
  })
  it('never goes negative', () => {
    expect(outputSpanMs(4000, 5000, 1500)).toBe(0)
  })
})

const ctx = (over: Partial<Parameters<typeof decideOnExit>[1]> = {}) =>
  ({ isAgent: true, underReview: false, activeAndFocused: false, ...over })

const idleCtx = (over: Partial<Parameters<typeof decideOnIdle>[1]> = {}) =>
  ({ ...ctx(), armed: true, workSpanMs: MIN_WORK_MS + 1000, ...over })

describe('decideOnIdle', () => {
  it('returns the classified state for a backgrounded agent', () => {
    expect(decideOnIdle('done', idleCtx())).toBe('done')
    expect(decideOnIdle('waiting-input', idleCtx())).toBe('waiting-input')
  })
  it('ignores non-agent terminals', () => {
    expect(decideOnIdle('done', idleCtx({ isAgent: false }))).toBeNull()
  })
  it('ignores terminals the review loop owns', () => {
    expect(decideOnIdle('done', idleCtx({ underReview: true }))).toBeNull()
  })
  it('stays silent when you are already looking at it', () => {
    expect(decideOnIdle('waiting-input', idleCtx({ activeAndFocused: true }))).toBeNull()
  })

  // A resize/SIGWINCH redraw flips busy on and off in well under MIN_WORK_MS —
  // that is not a turn ending, so it must not report 'done'.
  it('ignores done blips shorter than MIN_WORK_MS (redraws, not work)', () => {
    expect(decideOnIdle('done', idleCtx({ workSpanMs: 800 }))).toBeNull()
    expect(decideOnIdle('done', idleCtx({ workSpanMs: 0 }))).toBeNull()
  })
  // A permission prompt can appear immediately after submit (claude asks before
  // doing anything) — the agent is blocked on the user, span is irrelevant.
  it('reports waiting-input regardless of the busy span', () => {
    expect(decideOnIdle('waiting-input', idleCtx({ workSpanMs: 0 }))).toBe('waiting-input')
    expect(decideOnIdle('waiting-input', idleCtx({ workSpanMs: 200 }))).toBe('waiting-input')
  })

  // Idle signals only fire for a terminal the user has typed in since the last
  // alert — a disarmed terminal redrawing in the background stays silent.
  it('ignores unarmed terminals', () => {
    expect(decideOnIdle('done', idleCtx({ armed: false }))).toBeNull()
    expect(decideOnIdle('waiting-input', idleCtx({ armed: false }))).toBeNull()
  })
})

describe('decideOnExit', () => {
  it('flags a non-zero exit as error', () => {
    expect(decideOnExit(1, ctx())).toBe('error')
  })
  it('stays silent on a clean (0) exit', () => {
    expect(decideOnExit(0, ctx())).toBeNull()
  })
  it('ignores non-agent / under-review / focused', () => {
    expect(decideOnExit(1, ctx({ isAgent: false }))).toBeNull()
    expect(decideOnExit(1, ctx({ underReview: true }))).toBeNull()
    expect(decideOnExit(1, ctx({ activeAndFocused: true }))).toBeNull()
  })
})

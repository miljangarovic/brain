// src/renderer/src/attention/decide.test.ts
import { describe, it, expect } from 'vitest'
import { decideOnIdle, decideOnExit } from './decide'

const ctx = (over: Partial<Parameters<typeof decideOnIdle>[1]> = {}) =>
  ({ isAgent: true, underReview: false, activeAndFocused: false, ...over })

describe('decideOnIdle', () => {
  it('returns the classified state for a backgrounded agent', () => {
    expect(decideOnIdle('done', ctx())).toBe('done')
    expect(decideOnIdle('waiting-input', ctx())).toBe('waiting-input')
  })
  it('ignores non-agent terminals', () => {
    expect(decideOnIdle('done', ctx({ isAgent: false }))).toBeNull()
  })
  it('ignores terminals the review loop owns', () => {
    expect(decideOnIdle('done', ctx({ underReview: true }))).toBeNull()
  })
  it('stays silent when you are already looking at it', () => {
    expect(decideOnIdle('waiting-input', ctx({ activeAndFocused: true }))).toBeNull()
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

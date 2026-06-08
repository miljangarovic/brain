import { describe, it, expect } from 'vitest'
import { statusDot } from './status'

describe('statusDot', () => {
  it('reviewing/applying → spinner', () => {
    expect(statusDot('reviewing')).toBe('spinner')
    expect(statusDot('applying')).toBe('spinner')
  })
  it('review-ready/iteration-done → attention', () => {
    expect(statusDot('review-ready')).toBe('attention')
    expect(statusDot('iteration-done')).toBe('attention')
  })
  it('undefined → null', () => {
    expect(statusDot(undefined)).toBeNull()
  })
})

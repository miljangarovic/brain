import { describe, it, expect } from 'vitest'
import { statusDot } from './status'

describe('statusDot', () => {
  it('reviewing/applying → spinner', () => {
    expect(statusDot('reviewing')).toBe('spinner')
    expect(statusDot('applying')).toBe('spinner')
  })
  it('phase-approved/needs-decision → attention', () => {
    expect(statusDot('phase-approved')).toBe('attention')
    expect(statusDot('needs-decision')).toBe('attention')
  })
  it('under-review → active', () => {
    expect(statusDot('under-review')).toBe('active')
  })
  it('undefined → null', () => {
    expect(statusDot(undefined)).toBeNull()
  })
})

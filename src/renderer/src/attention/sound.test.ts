import { describe, it, expect, beforeEach } from 'vitest'
import { isMuted, setMuted, beep } from './sound'

describe('mute persistence', () => {
  beforeEach(() => localStorage.clear())
  it('defaults to not muted', () => {
    expect(isMuted()).toBe(false)
  })
  it('round-trips the muted flag', () => {
    setMuted(true)
    expect(isMuted()).toBe(true)
    setMuted(false)
    expect(isMuted()).toBe(false)
  })
})

describe('beep', () => {
  it('does not throw when no AudioContext is available (jsdom)', () => {
    expect(() => beep('done')).not.toThrow()
  })
})

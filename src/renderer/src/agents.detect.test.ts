import { describe, it, expect } from 'vitest'
import { detectAgent } from './agents'

describe('detectAgent', () => {
  it('maps a process name to an agent kind by substring (case-insensitive)', () => {
    expect(detectAgent('claude')).toBe('claude')
    expect(detectAgent('/usr/local/bin/codex')).toBe('codex')
    expect(detectAgent('Claude')).toBe('claude')
    expect(detectAgent('node claude')).toBe('claude')
  })
  it('returns null for non-agents / empty', () => {
    expect(detectAgent('bash')).toBeNull()
    expect(detectAgent('')).toBeNull()
    expect(detectAgent(undefined)).toBeNull()
    expect(detectAgent(null)).toBeNull()
  })
})

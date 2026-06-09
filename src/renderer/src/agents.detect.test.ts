import { describe, it, expect } from 'vitest'
import { detectAgent } from './agents'

describe('detectAgent', () => {
  it('maps a process name to an agent kind by substring (case-insensitive)', () => {
    expect(detectAgent('claude')).toBe('claude')
    expect(detectAgent('/usr/local/bin/codex')).toBe('codex')
    expect(detectAgent('Claude')).toBe('claude')
    expect(detectAgent('node claude')).toBe('claude')
    // codex ships as a node wrapper; main reports the child's full cmdline.
    expect(detectAgent('node /home/u/.nvm/versions/node/v22/bin/codex')).toBe('codex')
  })
  it('ignores ~/.claude and ~/.codex config-dir paths embedded in the cmdline', () => {
    // A codex reviewer launched with a prompt that points at the origin's
    // ~/.claude transcript — the path must NOT make it look like claude.
    expect(detectAgent("node /home/u/.nvm/versions/node/v22/bin/codex 'Read transcript at /home/u/.claude/projects/-x/s.jsonl'")).toBe('codex')
    // Mirror: a claude reviewer reading a ~/.codex session path stays claude.
    expect(detectAgent("claude 'Read transcript at /home/u/.codex/sessions/2026/s.jsonl'")).toBe('claude')
  })
  it('returns null for non-agents / empty', () => {
    expect(detectAgent('bash')).toBeNull()
    expect(detectAgent('')).toBeNull()
    expect(detectAgent(undefined)).toBeNull()
    expect(detectAgent(null)).toBeNull()
  })
})

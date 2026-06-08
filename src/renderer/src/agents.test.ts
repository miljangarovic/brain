import { describe, it, expect } from 'vitest'
import { AGENTS } from './agents'

describe('AGENTS', () => {
  it('defines claude and codex with label, command and default name', () => {
    expect(AGENTS.claude.command).toBe('claude')
    expect(AGENTS.codex.command).toBe('codex')
    expect(AGENTS.claude.label).toBe('Claude')
    expect(AGENTS.codex.label).toBe('Codex')
    expect(AGENTS.claude.defaultName).toBeTruthy()
    expect(AGENTS.codex.defaultName).toBeTruthy()
  })
})

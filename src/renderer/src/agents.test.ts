import { describe, it, expect } from 'vitest'
import { AGENTS, agentStartupCommand } from './agents'

describe('AGENTS', () => {
  it('defines claude and codex with label, command and default name', () => {
    expect(AGENTS.claude.command).toBe('claude')
    expect(AGENTS.codex.command).toBe('codex')
    expect(AGENTS.claude.label).toBe('Claude')
    expect(AGENTS.codex.label).toBe('Codex')
    expect(AGENTS.claude.defaultName).toBeTruthy()
    expect(AGENTS.codex.defaultName).toBeTruthy()
  })

  it('defines a resume command that continues the most recent session', () => {
    expect(AGENTS.claude.resumeCommand).toBe('claude --continue')
    expect(AGENTS.codex.resumeCommand).toBe('codex resume --last')
  })
})

describe('agentStartupCommand', () => {
  it('pins a fresh claude session and resumes that exact id later', () => {
    expect(agentStartupCommand({ kind: 'claude', sessionId: 'abc' })).toBe('claude --session-id abc')
    expect(agentStartupCommand({ kind: 'claude', sessionId: 'abc', resume: true })).toBe('claude --resume abc')
  })

  it('starts a fresh codex plainly and resumes by its detected id later', () => {
    expect(agentStartupCommand({ kind: 'codex' })).toBe('codex')
    expect(agentStartupCommand({ kind: 'codex', sessionId: 'xyz', resume: true })).toBe('codex resume xyz')
  })

  it('falls back to "most recent in cwd" when a restored agent has no known id (legacy)', () => {
    expect(agentStartupCommand({ kind: 'claude', resume: true })).toBe('claude --continue')
    expect(agentStartupCommand({ kind: 'codex', resume: true })).toBe('codex resume --last')
  })

  it('starts a fresh agent normally when no id was assigned', () => {
    expect(agentStartupCommand({ kind: 'claude' })).toBe('claude')
  })

  it('returns undefined for plain shells (caller uses the saved startupCommand)', () => {
    expect(agentStartupCommand({ kind: 'shell' })).toBeUndefined()
    expect(agentStartupCommand({ kind: undefined })).toBeUndefined()
  })
})

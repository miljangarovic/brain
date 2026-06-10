import { describe, it, expect } from 'vitest'
import { AGENTS, agentResumeCommand, agentLaunchCommand } from './agents'

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

describe('agentResumeCommand', () => {
  it('resumes claude and codex by exact id when one is known', () => {
    expect(agentResumeCommand({ kind: 'claude', sessionId: 'abc' })).toBe('claude --resume abc')
    expect(agentResumeCommand({ kind: 'codex', sessionId: 'xyz' })).toBe('codex resume xyz')
  })

  it('falls back to "most recent in cwd" when no id is known (legacy terminals)', () => {
    expect(agentResumeCommand({ kind: 'claude' })).toBe('claude --continue')
    expect(agentResumeCommand({ kind: 'codex' })).toBe('codex resume --last')
  })

  it('returns undefined for plain shells (caller uses the saved startupCommand)', () => {
    expect(agentResumeCommand({ kind: 'shell' })).toBeUndefined()
    expect(agentResumeCommand({ kind: undefined })).toBeUndefined()
  })
})

describe('agentLaunchCommand', () => {
  it('pins a fresh claude session by id', () => {
    expect(agentLaunchCommand('claude', 'abc')).toBe('claude --session-id abc')
  })

  it('starts claude plainly when no id is given', () => {
    expect(agentLaunchCommand('claude')).toBe('claude')
  })

  it('always starts codex plainly — its id is detected after launch', () => {
    expect(agentLaunchCommand('codex')).toBe('codex')
    expect(agentLaunchCommand('codex', 'ignored')).toBe('codex')
  })
})

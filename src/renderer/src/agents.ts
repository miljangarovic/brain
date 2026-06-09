// Quick-launch agent definitions. `command` is assumed to be on PATH.
import type { TerminalKind } from '@shared/types'

export type AgentKind = 'claude' | 'codex'

export interface AgentDef {
  label: string
  command: string
  // How to relaunch the agent so it picks up its previous session instead of
  // starting fresh — used when a terminal is restored after an app restart.
  // claude: `--continue` resumes the most recent conversation in the cwd;
  // codex: `resume --last` continues the most recent session for the cwd.
  resumeCommand: string
  defaultName: string
}

export const AGENTS: Record<AgentKind, AgentDef> = {
  claude: { label: 'Claude', command: 'claude', resumeCommand: 'claude --continue', defaultName: 'claude' },
  codex: { label: 'Codex', command: 'codex', resumeCommand: 'codex resume --last', defaultName: 'codex' }
}

// The actual command to spawn an agent terminal, resolving session continuity:
//  - fresh claude pins its id so it can be resumed later (claude --session-id X);
//    a restored claude reopens exactly that conversation (claude --resume X).
//  - codex can't pin an id at launch, so a fresh codex starts plain (its id is
//    detected afterwards) and a restored codex resumes by the detected id.
//  - without a known id (legacy terminals) we fall back to "most recent in cwd".
// Returns undefined for non-agents (plain shells) — the caller then uses the
// terminal's saved startupCommand.
export function agentStartupCommand(opts: {
  kind: TerminalKind | undefined
  sessionId?: string
  resume?: boolean
}): string | undefined {
  const { kind, sessionId, resume } = opts
  if (kind === 'claude') {
    if (sessionId) return resume ? `claude --resume ${sessionId}` : `claude --session-id ${sessionId}`
    return resume ? AGENTS.claude.resumeCommand : AGENTS.claude.command
  }
  if (kind === 'codex') {
    if (resume) return sessionId ? `codex resume ${sessionId}` : AGENTS.codex.resumeCommand
    return AGENTS.codex.command
  }
  return undefined
}

export function detectAgent(processName: string | null | undefined): AgentKind | null {
  if (!processName) return null
  // Drop `.claude` / `.codex` config-dir references first: a path like a
  // ~/.claude transcript embedded in a codex reviewer's prompt is a file path,
  // not the running binary, and would otherwise misidentify the agent.
  const p = processName.toLowerCase().replace(/\.(claude|codex)\b/g, '')
  if (p.includes('claude')) return 'claude'
  if (p.includes('codex')) return 'codex'
  return null
}

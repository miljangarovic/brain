// Quick-launch agent definitions. `command` is assumed to be on PATH.
import type { TerminalKind } from '@shared/types'
import { shellSingleQuote } from './shellQuote'

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

// How to relaunch a RESTORED agent terminal so it continues its own previous
// conversation: by pinned/detected id when one is known (claude --resume X /
// codex resume X), else the cwd's most recent session (legacy terminals
// persisted before ids were pinned). Returns undefined for plain shells — the
// caller falls back to the terminal's saved startupCommand. Fresh launches
// never go through here: their exact command (including any --session-id pin)
// is persisted as the terminal's startupCommand at creation time, so custom
// commands like a reviewer's prompt are never overridden.
export function agentResumeCommand(opts: {
  kind: TerminalKind | undefined
  sessionId?: string
}): string | undefined {
  const { kind, sessionId } = opts
  if (kind === 'claude') return sessionId ? `claude --resume ${sessionId}` : AGENTS.claude.resumeCommand
  if (kind === 'codex') return sessionId ? `codex resume ${sessionId}` : AGENTS.codex.resumeCommand
  return undefined
}

// The fresh-launch command for an agent, pinning the conversation id when the
// agent supports it (claude --session-id X; codex can't — its id is detected
// from the rollout file after launch). This is what gets persisted as the
// terminal's startupCommand.
export function agentLaunchCommand(kind: AgentKind, sessionId?: string): string {
  if (kind === 'claude' && sessionId) return `claude --session-id ${sessionId}`
  return AGENTS[kind].command
}

// Fresh launch with an optional first message — the voice add_terminal path.
// Same quoting as agentContinueCommand: the prompt rides as ONE shell argument.
export function agentLaunchCommandWithPrompt(kind: AgentKind, sessionId?: string, prompt?: string): string {
  const base = agentLaunchCommand(kind, sessionId)
  return prompt ? `${base} ${shellSingleQuote(prompt)}` : base
}

// Launch command for an IMPORTED agent terminal: a fresh conversation (id
// pinned when the agent supports it) whose first message points the agent at
// the handoff summary that was written when the terminal was exported.
export function agentContinueCommand(kind: AgentKind, summaryPath: string, sessionId?: string): string {
  const prompt = `Read ${summaryPath} — it is a handoff summary of a previous session. Continue the work from where it left off.`
  return `${agentLaunchCommand(kind, sessionId)} ${shellSingleQuote(prompt)}`
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

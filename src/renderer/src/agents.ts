// Quick-launch agent definitions. `command` is assumed to be on PATH.
export type AgentKind = 'claude' | 'codex'

export interface AgentDef {
  label: string
  command: string
  defaultName: string
}

export const AGENTS: Record<AgentKind, AgentDef> = {
  claude: { label: 'Claude', command: 'claude', defaultName: 'claude' },
  codex: { label: 'Codex', command: 'codex', defaultName: 'codex' }
}

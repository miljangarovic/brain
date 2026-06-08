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

export function detectAgent(processName: string | null | undefined): AgentKind | null {
  if (!processName) return null
  const p = processName.toLowerCase()
  if (p.includes('claude')) return 'claude'
  if (p.includes('codex')) return 'codex'
  return null
}

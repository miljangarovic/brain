export type TerminalKind = 'shell' | 'claude' | 'codex'

export interface Terminal {
  id: string
  name: string
  cwd: string            // '' means: resolve to home dir at spawn time
  startupCommand?: string
  shell?: string         // '' / undefined means: $SHELL || /bin/bash
  kind?: TerminalKind    // undefined === 'shell'
}

export interface Group {
  id: string
  name: string
  collapsed: boolean
  terminals: Terminal[]
}

export interface Workspace {
  groups: Group[]
}

export function createWorkspace(): Workspace {
  return { groups: [] }
}

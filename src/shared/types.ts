export type TerminalKind = 'shell' | 'claude' | 'codex'

export type ReviewKind = 'spec' | 'impl'

export interface ReviewLink {
  originTerminalId: string   // A — the implementer this terminal reviews
  reviewKind: ReviewKind
  specPath?: string          // absolute path of the artifact (only 'spec')
  reviewDir: string          // absolute dir for review-N.md (outside the project)
  round: number              // current round (1-based)
}

export type ReviewStatus = 'reviewing' | 'review-ready' | 'applying' | 'iteration-done'

export interface Terminal {
  id: string
  name: string
  cwd: string            // '' means: resolve to home dir at spawn time
  startupCommand?: string
  shell?: string         // '' / undefined means: $SHELL || /bin/bash
  kind?: TerminalKind    // undefined === 'shell'
  review?: ReviewLink    // present only on the reviewer terminal (B)
}

export interface Feature {
  id: string
  name: string
  collapsed: boolean
  viewMode?: 'tabs' | 'grid'   // undefined === 'tabs'
  terminals: Terminal[]
}

export interface Group {
  id: string
  name: string
  cwd: string                  // '' === home (~)
  collapsed: boolean
  features: Feature[]
}

export interface Workspace {
  groups: Group[]
}

export function createWorkspace(): Workspace {
  return { groups: [] }
}

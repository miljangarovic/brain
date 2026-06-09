export type TerminalKind = 'shell' | 'claude' | 'codex'

export type ReviewPhase = 'intent' | 'spec' | 'impl'

export interface ReviewLink {
  originTerminalId: string   // A — the implementer this terminal reviews
  phase: ReviewPhase         // where we are in the pipeline
  round: number              // 1-based round WITHIN the current phase
  maxRounds: number          // safety cap before stopping for a decision
  reviewDir: string          // absolute dir for review-<phase>-<round>.md (outside the project)
  transcriptPath?: string    // origin agent's session JSONL (intent phase)
  intentPath?: string        // artifact built in the intent phase
  specPath?: string          // artifact for the spec phase
}

export type ReviewStatus =
  | 'reviewing'        // B is writing its critique
  | 'applying'         // A is applying the feedback
  | 'under-review'     // A: loop active, awaiting/working — the origin indicator
  | 'needs-decision'   // B: maxRounds reached, waiting for the user
  | 'approved'         // A: phase passed review (reviewer closed) — green until the next request

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

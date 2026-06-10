import type { Feature, Group } from './types'

export const EXPORT_FORMAT = 'brain-export' as const
export const EXPORT_VERSION = 1 as const

export type AgentSessionKind = 'claude' | 'codex'

export interface SessionEntry {
  kind: AgentSessionKind
  file?: string    // zip-relative path under sessions/; absent when summarization failed
  error?: string   // why there is no summary; the export still succeeds
}

// What the renderer sends to export:run — the manifest is this plus bookkeeping.
// scope 'group' carries the full Group; scope 'feature' carries the Feature plus
// just enough of its group to recreate one on an empty workspace at import.
export type ExportScopeInput =
  | { scope: 'group'; group: Group }
  | { scope: 'feature'; group: { name: string; cwd: string }; feature: Feature }

interface ManifestCommon {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exportedAt: string
  sessions: Record<string, SessionEntry>   // key: ORIGINAL terminal id
}

export type ExportManifest = ManifestCommon & ExportScopeInput

export interface ExportProgress { done: number; total: number; current: string }

export interface ExportRunResult {
  ok: boolean
  canceled?: boolean
  path?: string
  warnings: string[]   // one entry per session that exported without a summary
}

export interface ImportRunResult {
  canceled?: boolean
  error?: string
  manifest?: ExportManifest
  dir?: string        // absolute dir the archive was extracted to
  cwdExists?: boolean // does manifest.group.cwd exist on THIS machine ('' counts as yes)
}

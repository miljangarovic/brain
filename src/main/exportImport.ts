import AdmZip from 'adm-zip'
import type { Feature } from '@shared/types'
import {
  EXPORT_FORMAT, EXPORT_VERSION,
  type AgentSessionKind, type ExportManifest, type ExportProgress, type ExportScopeInput, type SessionEntry
} from '@shared/exportTypes'
import { mapWithLimit, SUMMARY_CONCURRENCY, type SummaryResult } from './sessionSummary'

export function slugify(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return out || 'x'
}

export function sessionFileName(featureName: string, terminalName: string, terminalId: string): string {
  const shortId = terminalId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4)
  return `sessions/${slugify(featureName)}-${slugify(terminalName)}-${shortId}.md`
}

export interface AgentSessionRef {
  terminalId: string
  kind: AgentSessionKind
  sessionId: string
  cwd: string
  featureName: string
  terminalName: string
}

export function collectAgentSessions(input: ExportScopeInput): AgentSessionRef[] {
  const features: Feature[] = input.scope === 'group' ? input.group.features : [input.feature]
  const refs: AgentSessionRef[] = []
  for (const f of features)
    for (const t of f.terminals)
      if ((t.kind === 'claude' || t.kind === 'codex') && t.sessionId)
        refs.push({ terminalId: t.id, kind: t.kind, sessionId: t.sessionId, cwd: t.cwd, featureName: f.name, terminalName: t.name })
  return refs
}

// Summarize every agent session (bounded concurrency), then write the archive:
// manifest.json + sessions/*.md. A failed summary records an `error` in the
// manifest and a warning in the result — it never aborts the export.
export async function runExport(opts: {
  input: ExportScopeInput
  outPath: string
  summarize: (ref: AgentSessionRef) => Promise<SummaryResult>
  onProgress?: (p: ExportProgress) => void
  now?: () => Date
}): Promise<{ warnings: string[] }> {
  const { input, outPath, summarize, onProgress } = opts
  const refs = collectAgentSessions(input)
  const sessions: Record<string, SessionEntry> = {}
  const files: { name: string; content: string }[] = []
  let done = 0
  onProgress?.({ done, total: refs.length, current: '' })
  await mapWithLimit(refs, SUMMARY_CONCURRENCY, async (ref) => {
    const res = await summarize(ref)
    if (res.ok) {
      const file = sessionFileName(ref.featureName, ref.terminalName, ref.terminalId)
      sessions[ref.terminalId] = { kind: ref.kind, file }
      files.push({ name: file, content: res.markdown })
    } else {
      sessions[ref.terminalId] = { kind: ref.kind, error: res.error }
    }
    done++
    onProgress?.({ done, total: refs.length, current: `${ref.featureName}/${ref.terminalName}` })
  })

  const common = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: (opts.now?.() ?? new Date()).toISOString(),
    sessions
  }
  const manifest: ExportManifest = input.scope === 'group'
    ? { ...common, scope: 'group', group: input.group }
    : { ...common, scope: 'feature', group: input.group, feature: input.feature }

  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
  for (const f of files) zip.addFile(f.name, Buffer.from(f.content, 'utf8'))
  await zip.writeZipPromise(outPath)

  const warnings = refs
    .filter((r) => sessions[r.terminalId]?.error)
    .map((r) => `${r.featureName}/${r.terminalName}: ${sessions[r.terminalId].error}`)
  return { warnings }
}

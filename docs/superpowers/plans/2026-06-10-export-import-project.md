# Export / Import Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a project (Group) or single Feature to a `.zip` (manifest.json + per-session LLM handoff summaries as .md), and import it back with fresh ids, cwd remapping, and agent terminals that continue from their summaries.

**Architecture:** Main process gets two new modules — `sessionSummary.ts` (headless `claude -p --resume` / `codex exec resume` summarization with timeout + concurrency limit) and `exportImport.ts` (manifest build, adm-zip archive build/extract/validate) — exposed via three new IPC channels. The renderer gets a pure `importRemap.ts` (fresh ids, cwd prefix remap, continue startup commands, review-link stripping), two store insertors, sidebar menu entries, and a progress toast.

**Tech Stack:** Electron 31, React 18, TypeScript, vitest (+ @testing-library/react), adm-zip (new dependency).

**Spec:** `docs/superpowers/specs/2026-06-10-export-import-project-design.md`

**Branch:** create `feature/export-import` off `develop` before Task 1 (user's workflow: feature branch → `--no-ff` merge).

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/exportTypes.ts` (new) | Manifest/result/progress types shared by main + renderer |
| `src/shared/ipc.ts` (modify) | 4 new channel constants |
| `src/shared/api.ts` (modify) | 4 new BrainApi methods |
| `src/preload/index.ts` (modify) | Bridge implementations |
| `src/main/sessionSummary.ts` (new) | Headless agent summarization (spawn, timeout, concurrency) |
| `src/main/exportImport.ts` (new) | Manifest build, zip build, zip extract + validate |
| `src/main/ipc.ts` (modify) | `export:run`, `import:run`, `fs:exists` handlers |
| `src/renderer/src/shellQuote.ts` (new) | `shellSingleQuote` moved out of review/prompt.ts (now needed by agents.ts too) |
| `src/renderer/src/agents.ts` (modify) | `agentContinueCommand` |
| `src/renderer/src/importRemap.ts` (new) | Pure import transformation (ids, cwds, startup commands) |
| `src/renderer/src/store.ts` (modify) | `addImportedGroup`, `addImportedFeature` |
| `src/renderer/src/components/Sidebar.tsx` (modify) | Export menu items, feature context menu, Import button |
| `src/renderer/src/components/ExportToast.tsx` (new) | Progress/result toast |
| `src/renderer/src/App.tsx` (modify) | Wiring: handlers, progress subscription, spawn gating |

---

### Task 0: Branch + dependency

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feature/export-import
```

- [ ] **Step 2: Install adm-zip**

```bash
npm install adm-zip && npm install -D @types/adm-zip
```

Expected: `adm-zip` lands under `"dependencies"` (it runs in the main process at runtime — it must NOT be a devDependency; electron-vite externalizes runtime deps via `externalizeDepsPlugin`), `@types/adm-zip` under `"devDependencies"`.

- [ ] **Step 3: Sanity-check the suite still passes**

Run: `npm test`
Expected: all existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add adm-zip for project export/import archives"
```

---

### Task 1: Shared types + IPC channel constants

**Files:**
- Create: `src/shared/exportTypes.ts`
- Modify: `src/shared/ipc.ts`

Types only — no unit test; the gate is `typecheck`.

- [ ] **Step 1: Create `src/shared/exportTypes.ts`**

```typescript
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
```

- [ ] **Step 2: Add channels to `src/shared/ipc.ts`**

Append inside the `IPC` object (after `linksResolve: 'links:resolve'` — add a trailing comma to that line):

```typescript
  exportRun: 'export:run',
  exportProgress: 'export:progress',
  importRun: 'import:run',
  fsExists: 'fs:exists'
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/shared/exportTypes.ts src/shared/ipc.ts
git commit -m "feat(export): shared manifest types and IPC channels"
```

---

### Task 2: Session summarization (main) — `sessionSummary.ts`

**Files:**
- Create: `src/main/sessionSummary.ts`
- Test: `src/main/sessionSummary.test.ts`

- [ ] **Step 1: Verify the real CLI flags (informational — do not skip)**

Run:

```bash
claude --help 2>&1 | grep -E "\-\-resume|\-\-print|\-p\b" ; codex exec --help 2>&1 | grep -E "output-last-message|skip-git" ; codex exec resume --help 2>&1 | head -20
```

Expected: `claude` supports `-p`/`--print` and `--resume <id>`; `codex exec` supports `--output-last-message <file>` and `--skip-git-repo-check`; `codex exec resume <SESSION_ID> [PROMPT]` exists. If a flag differs on this machine, adjust `summaryCommand` below to match the installed CLIs and note it in the commit message.

- [ ] **Step 2: Write the failing test**

Create `src/main/sessionSummary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  summaryCommand, summarizeSession, mapWithLimit, SUMMARY_PROMPT, type SpawnLike
} from './sessionSummary'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill() { this.killed = true }
}

// A SpawnLike whose child is driven by `script` on the next microtask.
function fakeSpawn(script: (child: FakeChild) => void): { spawnFn: SpawnLike; calls: { command: string; args: string[]; cwd: string }[] } {
  const calls: { command: string; args: string[]; cwd: string }[] = []
  const spawnFn: SpawnLike = (command, args, opts) => {
    calls.push({ command, args, cwd: opts.cwd })
    const child = new FakeChild()
    queueMicrotask(() => script(child))
    return child
  }
  return { spawnFn, calls }
}

describe('summaryCommand', () => {
  it('claude: headless resume with the summary prompt', () => {
    expect(summaryCommand('claude', 'sid-1', '/tmp/out.md')).toEqual({
      command: 'claude',
      args: ['-p', '--resume', 'sid-1', SUMMARY_PROMPT]
    })
  })

  it('codex: exec resume writing the last message to a file', () => {
    expect(summaryCommand('codex', 'sid-2', '/tmp/out.md')).toEqual({
      command: 'codex',
      args: ['exec', 'resume', 'sid-2', '--skip-git-repo-check', '--output-last-message', '/tmp/out.md', SUMMARY_PROMPT]
    })
  })
})

describe('summarizeSession', () => {
  it('claude: returns trimmed stdout on exit 0, spawned in the terminal cwd', async () => {
    const { spawnFn, calls } = fakeSpawn((c) => {
      c.stdout.emit('data', '## Summary\n')
      c.stdout.emit('data', 'done\n')
      c.emit('close', 0)
    })
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/proj', spawnFn })
    expect(res).toEqual({ ok: true, markdown: '## Summary\ndone' })
    expect(calls[0].cwd).toBe('/proj')
  })

  it('claude: empty stdout is an error', async () => {
    const { spawnFn } = fakeSpawn((c) => c.emit('close', 0))
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/p', spawnFn })
    expect(res).toEqual({ ok: false, error: 'claude produced no output' })
  })

  it('non-zero exit becomes an error carrying stderr', async () => {
    const { spawnFn } = fakeSpawn((c) => {
      c.stderr.emit('data', 'No conversation found')
      c.emit('close', 2)
    })
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/p', spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('No conversation found')
  })

  it('spawn error (CLI not installed) becomes an error', async () => {
    const { spawnFn } = fakeSpawn((c) => c.emit('error', new Error('spawn claude ENOENT')))
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/p', spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ENOENT')
  })

  it('times out and kills the child when nothing comes back', async () => {
    let spawned: FakeChild | null = null
    const { spawnFn } = fakeSpawn((c) => { spawned = c /* never closes */ })
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/p', spawnFn, timeoutMs: 20 })
    expect(res).toEqual({ ok: false, error: 'summarization timed out' })
    expect(spawned!.killed).toBe(true)
  })

  it('codex: reads the markdown from the output file and removes it', async () => {
    const out = join(tmpdir(), `brain-sum-test-${Math.random().toString(36).slice(2)}.md`)
    const { spawnFn } = fakeSpawn((c) => {
      void fsp.writeFile(out, '# Codex summary\n').then(() => c.emit('close', 0))
    })
    const res = await summarizeSession({ kind: 'codex', sessionId: 's', cwd: '/p', spawnFn, outputFile: out })
    expect(res).toEqual({ ok: true, markdown: '# Codex summary' })
    await expect(fsp.access(out)).rejects.toThrow()
  })

  it('codex: missing output file is an error', async () => {
    const out = join(tmpdir(), `brain-sum-test-${Math.random().toString(36).slice(2)}.md`)
    const { spawnFn } = fakeSpawn((c) => c.emit('close', 0))
    const res = await summarizeSession({ kind: 'codex', sessionId: 's', cwd: '/p', spawnFn, outputFile: out })
    expect(res).toEqual({ ok: false, error: 'codex wrote no summary file' })
  })
})

describe('mapWithLimit', () => {
  it('preserves order and never exceeds the limit', async () => {
    let running = 0
    let peak = 0
    const delays = [30, 10, 20, 5, 15]
    const out = await mapWithLimit(delays, 2, async (ms, i) => {
      running++; peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, ms))
      running--
      return i
    })
    expect(out).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/main/sessionSummary.test.ts`
Expected: FAIL — `Cannot find module './sessionSummary'` (or equivalent).

- [ ] **Step 4: Implement `src/main/sessionSummary.ts`**

```typescript
import { spawn } from 'child_process'
import { promises as fsp } from 'fs'
import * as os from 'os'
import { join } from 'path'
import type { AgentSessionKind } from '@shared/exportTypes'

// What the agent is asked at export time — the answer becomes the session's
// handoff .md, fed back as the first prompt when the import is opened.
export const SUMMARY_PROMPT =
  'Write a handoff summary of this session as markdown, in the same language as the conversation: ' +
  'goal, current state, key decisions, files touched, and concrete next steps. Output only the markdown.'

export const SUMMARY_TIMEOUT_MS = 180_000
export const SUMMARY_CONCURRENCY = 3

export type SummaryResult = { ok: true; markdown: string } | { ok: false; error: string }

// Structural slice of ChildProcess so tests can hand in a plain EventEmitter.
export interface ChildLike {
  stdout?: { on(event: 'data', cb: (d: unknown) => void): unknown } | null
  stderr?: { on(event: 'data', cb: (d: unknown) => void): unknown } | null
  on(event: 'error', cb: (err: Error) => void): unknown
  on(event: 'close', cb: (code: number | null) => void): unknown
  kill(): void
}
export type SpawnLike = (command: string, args: string[], opts: { cwd: string; stdio: ['ignore', 'pipe', 'pipe'] }) => ChildLike

// claude prints the summary on stdout (-p); codex's stdout carries TUI noise,
// so it writes the last message to a file instead (--output-last-message).
// `-p --resume` / `exec resume` leave the original session intact.
export function summaryCommand(kind: AgentSessionKind, sessionId: string, outputFile: string): { command: string; args: string[] } {
  if (kind === 'claude') return { command: 'claude', args: ['-p', '--resume', sessionId, SUMMARY_PROMPT] }
  return { command: 'codex', args: ['exec', 'resume', sessionId, '--skip-git-repo-check', '--output-last-message', outputFile, SUMMARY_PROMPT] }
}

export async function summarizeSession(opts: {
  kind: AgentSessionKind
  sessionId: string
  cwd: string            // '' resolves to home, mirroring terminal spawn
  spawnFn?: SpawnLike
  timeoutMs?: number
  outputFile?: string
}): Promise<SummaryResult> {
  const { kind, sessionId } = opts
  const spawnFn: SpawnLike = opts.spawnFn ?? (spawn as unknown as SpawnLike)
  const timeoutMs = opts.timeoutMs ?? SUMMARY_TIMEOUT_MS
  const outputFile = opts.outputFile ?? join(os.tmpdir(), `brain-summary-${sessionId}.md`)
  const { command, args } = summaryCommand(kind, sessionId, outputFile)
  // claude resolves --resume per project dir, so the cwd must be the terminal's.
  const cwd = opts.cwd || os.homedir()

  const run = await new Promise<{ code: number; stdout: string; stderr: string } | { error: string }>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (v: { code: number; stdout: string; stderr: string } | { error: string }) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(v)
    }
    let child: ChildLike
    try {
      child = spawnFn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      finish({ error: String(err) })
      return
    }
    timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish({ error: 'summarization timed out' })
    }, timeoutMs)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('error', (err) => finish({ error: `${command}: ${err.message}` }))
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }))
  })

  if ('error' in run) return { ok: false, error: run.error }
  if (run.code !== 0) return { ok: false, error: `${command} exited ${run.code}: ${run.stderr.trim().slice(-400)}` }
  if (kind === 'claude') {
    const markdown = run.stdout.trim()
    return markdown ? { ok: true, markdown } : { ok: false, error: 'claude produced no output' }
  }
  try {
    const markdown = (await fsp.readFile(outputFile, 'utf8')).trim()
    await fsp.rm(outputFile, { force: true })
    return markdown ? { ok: true, markdown } : { ok: false, error: 'codex produced no output' }
  } catch {
    return { ok: false, error: 'codex wrote no summary file' }
  }
}

// Run `fn` over `items` with at most `limit` in flight; results keep item order.
export async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/main/sessionSummary.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/main/sessionSummary.ts src/main/sessionSummary.test.ts
git commit -m "feat(export): headless claude/codex session summarization"
```

---

### Task 3: Export archive build (main) — `exportImport.ts` part 1

**Files:**
- Create: `src/main/exportImport.ts`
- Test: `src/main/exportImport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/exportImport.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Group } from '@shared/types'
import type { ExportManifest } from '@shared/exportTypes'
import { slugify, sessionFileName, collectAgentSessions, runExport } from './exportImport'

const tmpZip = () => join(tmpdir(), `brain-export-test-${Math.random().toString(36).slice(2)}.zip`)

const group: Group = {
  id: 'g1', name: 'My Proj', cwd: '/home/me/proj', collapsed: false, features: [
    { id: 'f1', name: 'Auth Flow', collapsed: false, terminals: [
      { id: 'aaaa1111-0000-0000-0000-000000000000', name: 'claude', cwd: '/home/me/proj', kind: 'claude', sessionId: 'cs-1' },
      { id: 'bbbb2222-0000-0000-0000-000000000000', name: 'codex', cwd: '/home/me/proj', kind: 'codex', sessionId: 'cx-1' },
      { id: 't-shell', name: 'shell', cwd: '/home/me/proj' },
      { id: 't-nosess', name: 'claude', cwd: '/home/me/proj', kind: 'claude' }
    ] }
  ]
}

describe('slugify / sessionFileName', () => {
  it('slugifies to lowercase ascii with dashes', () => {
    expect(slugify('Auth Flow!')).toBe('auth-flow')
    expect(slugify('***')).toBe('x')
  })
  it('names the md after feature, terminal and a short id', () => {
    expect(sessionFileName('Auth Flow', 'claude', 'aaaa1111-0000')).toBe('sessions/auth-flow-claude-aaaa.md')
  })
})

describe('collectAgentSessions', () => {
  it('collects only agent terminals that have a sessionId', () => {
    const refs = collectAgentSessions({ scope: 'group', group })
    expect(refs.map((r) => r.sessionId)).toEqual(['cs-1', 'cx-1'])
    expect(refs[0]).toMatchObject({ kind: 'claude', cwd: '/home/me/proj', featureName: 'Auth Flow', terminalName: 'claude' })
  })
  it('feature scope collects from the single feature', () => {
    const refs = collectAgentSessions({ scope: 'feature', group: { name: 'My Proj', cwd: '/home/me/proj' }, feature: group.features[0] })
    expect(refs).toHaveLength(2)
  })
})

describe('runExport', () => {
  it('writes a zip with manifest + one md per successful summary; failures become warnings', async () => {
    const out = tmpZip()
    const progress: { done: number; total: number }[] = []
    const { warnings } = await runExport({
      input: { scope: 'group', group },
      outPath: out,
      summarize: async (ref) => ref.kind === 'claude'
        ? { ok: true, markdown: '# Claude summary' }
        : { ok: false, error: 'summarization timed out' },
      onProgress: (p) => progress.push({ done: p.done, total: p.total })
    })
    expect(warnings).toEqual(['Auth Flow/codex: summarization timed out'])
    expect(progress[0]).toEqual({ done: 0, total: 2 })
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 })

    const zip = new AdmZip(out)
    const manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8')) as ExportManifest
    expect(manifest.format).toBe('brain-export')
    expect(manifest.version).toBe(1)
    expect(manifest.scope).toBe('group')
    expect((manifest.group as Group).features[0].terminals).toHaveLength(4)
    expect(manifest.sessions['aaaa1111-0000-0000-0000-000000000000']).toEqual({ kind: 'claude', file: 'sessions/auth-flow-claude-aaaa.md' })
    expect(manifest.sessions['bbbb2222-0000-0000-0000-000000000000']).toEqual({ kind: 'codex', error: 'summarization timed out' })
    expect(zip.getEntry('sessions/auth-flow-claude-aaaa.md')!.getData().toString('utf8')).toBe('# Claude summary')
    await fsp.rm(out, { force: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/exportImport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/exportImport.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/exportImport.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/exportImport.ts src/main/exportImport.test.ts
git commit -m "feat(export): manifest build and zip archive writer"
```

---

### Task 4: Import extract + validate (main) — `exportImport.ts` part 2

**Files:**
- Modify: `src/main/exportImport.ts`
- Test: `src/main/exportImport.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to `src/main/exportImport.test.ts`; also add `validateManifest, extractImportArchive` to the import from `'./exportImport'`)

```typescript
describe('validateManifest', () => {
  const base = { format: 'brain-export', version: 1, exportedAt: 'x', sessions: {} }
  it('accepts a group manifest', () => {
    expect(validateManifest({ ...base, scope: 'group', group: { features: [] } })).not.toBeNull()
  })
  it('accepts a feature manifest', () => {
    expect(validateManifest({ ...base, scope: 'feature', group: { name: 'p', cwd: '/p' }, feature: { terminals: [] } })).not.toBeNull()
  })
  it('rejects wrong format, version, scope, or shape', () => {
    expect(validateManifest(null)).toBeNull()
    expect(validateManifest({ ...base, format: 'other', scope: 'group', group: { features: [] } })).toBeNull()
    expect(validateManifest({ ...base, version: 2, scope: 'group', group: { features: [] } })).toBeNull()
    expect(validateManifest({ ...base, scope: 'nope' })).toBeNull()
    expect(validateManifest({ ...base, scope: 'group', group: {} })).toBeNull()
    expect(validateManifest({ ...base, scope: 'feature', group: { name: 'p' }, feature: { terminals: [] } })).toBeNull()
  })
})

describe('extractImportArchive', () => {
  const tmpDir = () => join(tmpdir(), `brain-import-test-${Math.random().toString(36).slice(2)}`)

  async function makeArchive(manifest: unknown, files: Record<string, string> = {}): Promise<string> {
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'))
    for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content, 'utf8'))
    const out = tmpZip()
    await zip.writeZipPromise(out)
    return out
  }

  const manifest = {
    format: 'brain-export', version: 1, exportedAt: 'x', scope: 'group',
    group: { id: 'g', name: 'p', cwd: '/p', collapsed: false, features: [] },
    sessions: {
      t1: { kind: 'claude', file: 'sessions/auth-claude-aaaa.md' },
      t2: { kind: 'codex', file: '../evil.md' },
      t3: { kind: 'codex', file: 'sessions/gone.md' }
    }
  }

  it('extracts the manifest and well-formed session files; bad paths and missing entries degrade to errors', async () => {
    const zipPath = await makeArchive(manifest, { 'sessions/auth-claude-aaaa.md': '# md', '../evil.md': 'evil' })
    const dest = tmpDir()
    const res = await extractImportArchive(zipPath, dest)
    expect('manifest' in res).toBe(true)
    if ('manifest' in res) {
      expect(res.dir).toBe(dest)
      expect(await fsp.readFile(join(dest, 'sessions/auth-claude-aaaa.md'), 'utf8')).toBe('# md')
      expect(res.manifest.sessions.t1.file).toBe('sessions/auth-claude-aaaa.md')
      expect(res.manifest.sessions.t2).toEqual({ kind: 'codex', error: 'invalid session file path' })
      expect(res.manifest.sessions.t3).toEqual({ kind: 'codex', error: 'session file missing from archive' })
      await expect(fsp.access(join(dest, '..', 'evil.md'))).rejects.toThrow()
    }
    await fsp.rm(zipPath, { force: true })
    await fsp.rm(dest, { recursive: true, force: true })
  })

  it('errors on a zip without manifest.json', async () => {
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('hi'))
    const out = tmpZip()
    await zip.writeZipPromise(out)
    expect(await extractImportArchive(out, tmpDir())).toEqual({ error: 'Not a Brain export: manifest.json is missing' })
    await fsp.rm(out, { force: true })
  })

  it('errors on an invalid manifest', async () => {
    const zipPath = await makeArchive({ format: 'other' })
    expect(await extractImportArchive(zipPath, tmpDir())).toEqual({ error: 'Unsupported or invalid manifest' })
    await fsp.rm(zipPath, { force: true })
  })

  it('errors on a file that is not a zip', async () => {
    const p = join(tmpdir(), `brain-notzip-${Math.random().toString(36).slice(2)}.zip`)
    await fsp.writeFile(p, 'plain text')
    expect(await extractImportArchive(p, tmpDir())).toEqual({ error: 'Not a readable zip archive' })
    await fsp.rm(p, { force: true })
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/main/exportImport.test.ts`
Expected: FAIL — `validateManifest` / `extractImportArchive` not exported.

- [ ] **Step 3: Implement** (append to `src/main/exportImport.ts`; add `import { promises as fsp } from 'fs'` and `import { join } from 'path'` to the imports)

```typescript
// Only paths this exporter itself generates are accepted — also the zip-slip guard.
const SESSION_FILE_RE = /^sessions\/[a-z0-9][a-z0-9-]*\.md$/

export function validateManifest(raw: unknown): ExportManifest | null {
  const m = raw as Record<string, unknown> | null
  if (!m || m['format'] !== EXPORT_FORMAT || m['version'] !== EXPORT_VERSION) return null
  const group = m['group'] as Record<string, unknown> | undefined
  if (!group || typeof m['sessions'] !== 'object' || m['sessions'] === null) return null
  if (m['scope'] === 'group')
    return Array.isArray(group['features']) ? (m as unknown as ExportManifest) : null
  if (m['scope'] === 'feature') {
    const feature = m['feature'] as Record<string, unknown> | undefined
    return feature && Array.isArray(feature['terminals']) && typeof group['name'] === 'string' && typeof group['cwd'] === 'string'
      ? (m as unknown as ExportManifest)
      : null
  }
  return null
}

// Read + validate the manifest, then extract ONLY the session files it names
// (each checked against SESSION_FILE_RE — nothing can escape destDir). A bad or
// missing session entry degrades to an error on that entry, like at export.
export async function extractImportArchive(zipPath: string, destDir: string): Promise<{ manifest: ExportManifest; dir: string } | { error: string }> {
  let zip: AdmZip
  try { zip = new AdmZip(zipPath) } catch { return { error: 'Not a readable zip archive' } }
  const manifestEntry = zip.getEntry('manifest.json')
  if (!manifestEntry) return { error: 'Not a Brain export: manifest.json is missing' }
  let manifest: ExportManifest | null = null
  try { manifest = validateManifest(JSON.parse(manifestEntry.getData().toString('utf8'))) } catch { /* invalid JSON */ }
  if (!manifest) return { error: 'Unsupported or invalid manifest' }
  await fsp.mkdir(join(destDir, 'sessions'), { recursive: true })
  for (const entry of Object.values(manifest.sessions)) {
    if (!entry.file) continue
    if (!SESSION_FILE_RE.test(entry.file)) {
      delete entry.file
      entry.error = 'invalid session file path'
      continue
    }
    const fileEntry = zip.getEntry(entry.file)
    if (!fileEntry) {
      delete entry.file
      entry.error = 'session file missing from archive'
      continue
    }
    await fsp.writeFile(join(destDir, entry.file), fileEntry.getData())
  }
  return { manifest, dir: destDir }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/exportImport.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/main/exportImport.ts src/main/exportImport.test.ts
git commit -m "feat(import): archive extraction with manifest validation and zip-slip guard"
```

---

### Task 5: IPC handlers + preload bridge + BrainApi

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`

Electron-bound wiring; the gate is typecheck + the full suite (consistent with the rest of `ipc.ts`, which has no unit tests).

- [ ] **Step 1: Add methods to `BrainApi` in `src/shared/api.ts`**

Add to the imports:

```typescript
import type { ExportProgress, ExportRunResult, ExportScopeInput, ImportRunResult } from './exportTypes'
```

Add to the interface (before the closing brace):

```typescript
  // Export a project/feature to a zip: save dialog first, then headless session
  // summarization in the main process; progress arrives via onExportProgress.
  exportArchive(input: ExportScopeInput): Promise<ExportRunResult>
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  // Pick an exported zip, extract it under userData/imports/, return the manifest.
  importArchive(): Promise<ImportRunResult>
  pathsExist(paths: string[]): Promise<boolean[]>
```

- [ ] **Step 2: Implement the preload bridge in `src/preload/index.ts`**

Add to the imports:

```typescript
import type { ExportProgress, ExportRunResult, ExportScopeInput, ImportRunResult } from '../shared/exportTypes'
```

Add to the `api` object (after `resolvePathLinks`):

```typescript
  exportArchive: (input: ExportScopeInput) => ipcRenderer.invoke(IPC.exportRun, input) as Promise<ExportRunResult>,
  onExportProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ExportProgress) => cb(p)
    ipcRenderer.on(IPC.exportProgress, listener)
    return () => ipcRenderer.removeListener(IPC.exportProgress, listener)
  },
  importArchive: () => ipcRenderer.invoke(IPC.importRun) as Promise<ImportRunResult>,
  pathsExist: (paths: string[]) => ipcRenderer.invoke(IPC.fsExists, { paths }) as Promise<boolean[]>
```

- [ ] **Step 3: Register the handlers in `src/main/ipc.ts`**

Add to the imports:

```typescript
import { runExport, extractImportArchive, slugify } from './exportImport'
import { summarizeSession } from './sessionSummary'
import type { ExportScopeInput } from '@shared/exportTypes'
import { randomUUID } from 'crypto'
import { join } from 'path'
```

Add inside `registerIpc` (before `return saver`):

```typescript
  const pathExists = (p: string): Promise<boolean> => fsp.access(p).then(() => true, () => false)

  // Export a project/feature: ask where to save FIRST (cancel costs nothing),
  // then summarize each agent session headlessly and write the archive.
  ipcMain.handle(IPC.exportRun, async (_e, input: ExportScopeInput) => {
    const win = getWin()
    const name = input.scope === 'group' ? input.group.name : input.feature.name
    const options: Electron.SaveDialogOptions = {
      defaultPath: `${slugify(name)}-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { ok: false, canceled: true, warnings: [] }
    try {
      const { warnings } = await runExport({
        input,
        outPath: res.filePath,
        summarize: (ref) => summarizeSession({ kind: ref.kind, sessionId: ref.sessionId, cwd: ref.cwd }),
        onProgress: (p) => send(IPC.exportProgress, p)
      })
      return { ok: true, path: res.filePath, warnings }
    } catch (err) {
      return { ok: false, warnings: [String(err)] }
    }
  })

  // Import an exported zip: extract under userData/imports/<uuid>/ (the session
  // .md files live there permanently — imported startup prompts reference them).
  ipcMain.handle(IPC.importRun, async () => {
    const win = getWin()
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || res.filePaths.length === 0) return { canceled: true }
    const out = await extractImportArchive(res.filePaths[0], join(userDataDir, 'imports', randomUUID()))
    if ('error' in out) return { error: out.error }
    const root = out.manifest.group.cwd
    return { manifest: out.manifest, dir: out.dir, cwdExists: root === '' ? true : await pathExists(root) }
  })

  ipcMain.handle(IPC.fsExists, (_e, p: { paths: string[] }) => Promise.all((p?.paths ?? []).map(pathExists)))
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/shared/api.ts src/preload/index.ts
git commit -m "feat(export): export/import/fsExists IPC surface"
```

---

### Task 6: `shellQuote.ts` + `agentContinueCommand`

**Files:**
- Create: `src/renderer/src/shellQuote.ts`
- Modify: `src/renderer/src/review/prompt.ts:3-6` (move `shellSingleQuote` out, re-export for existing callers)
- Modify: `src/renderer/src/agents.ts`
- Test: `src/renderer/src/agents.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `src/renderer/src/agents.test.ts`; extend the existing import from `'./agents'` with `agentContinueCommand`)

```typescript
describe('agentContinueCommand', () => {
  it('claude: pins a fresh session id and opens with the summary prompt', () => {
    const cmd = agentContinueCommand('claude', '/data/imports/abc/sessions/auth-claude-aaaa.md', 'sid-9')
    expect(cmd).toBe(
      `claude --session-id sid-9 'Read /data/imports/abc/sessions/auth-claude-aaaa.md — it is a handoff summary of a previous session. Continue the work from where it left off.'`
    )
  })

  it('codex: plain launch with the summary prompt (no id pinning)', () => {
    const cmd = agentContinueCommand('codex', '/data/s.md')
    expect(cmd).toBe(`codex 'Read /data/s.md — it is a handoff summary of a previous session. Continue the work from where it left off.'`)
  })

  it('single quotes in the path are shell-escaped', () => {
    expect(agentContinueCommand('codex', "/data/it's.md")).toContain(`'Read /data/it'\\''s.md`)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/agents.test.ts`
Expected: FAIL — `agentContinueCommand` is not exported.

- [ ] **Step 3: Create `src/renderer/src/shellQuote.ts`**

```typescript
/** POSIX single-quote escaping for embedding a prompt as one shell argument. */
export function shellSingleQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}
```

- [ ] **Step 4: Point `review/prompt.ts` at it**

In `src/renderer/src/review/prompt.ts`, delete the local `shellSingleQuote` function (lines 3–6) and add at the top:

```typescript
export { shellSingleQuote } from '../shellQuote'
import { shellSingleQuote } from '../shellQuote'
```

(The re-export keeps existing `import { shellSingleQuote } from './review/prompt'` call sites and tests working.)

- [ ] **Step 5: Add `agentContinueCommand` to `src/renderer/src/agents.ts`**

Add the import:

```typescript
import { shellSingleQuote } from './shellQuote'
```

Add after `agentLaunchCommand`:

```typescript
// Launch command for an IMPORTED agent terminal: a fresh conversation (id
// pinned when the agent supports it) whose first message points the agent at
// the handoff summary that was written when the terminal was exported.
export function agentContinueCommand(kind: AgentKind, summaryPath: string, sessionId?: string): string {
  const prompt = `Read ${summaryPath} — it is a handoff summary of a previous session. Continue the work from where it left off.`
  return `${agentLaunchCommand(kind, sessionId)} ${shellSingleQuote(prompt)}`
}
```

- [ ] **Step 6: Run the tests (agents + review, both touched)**

Run: `npx vitest run src/renderer/src/agents.test.ts src/renderer/src/review/`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/src/shellQuote.ts src/renderer/src/review/prompt.ts src/renderer/src/agents.ts src/renderer/src/agents.test.ts
git commit -m "feat(import): continue-from-summary launch command; extract shellSingleQuote"
```

---

### Task 7: Pure import transformation — `importRemap.ts`

**Files:**
- Create: `src/renderer/src/importRemap.ts`
- Test: `src/renderer/src/importRemap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/importRemap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Group } from '@shared/types'
import type { ExportManifest } from '@shared/exportTypes'
import { remapCwd, collectCwdCandidates, buildImport } from './importRemap'

const counterId = () => { let n = 0; return () => `new-${++n}` }

const group: Group = {
  id: 'g1', name: 'proj', cwd: '/old/proj', collapsed: true, features: [
    { id: 'f1', name: 'auth', collapsed: false, viewMode: 'grid', gridStyle: 'rows', terminals: [
      { id: 't-claude', name: 'claude', cwd: '/old/proj', kind: 'claude', sessionId: 'dead-1' },
      { id: 't-codex', name: 'codex', cwd: '/old/proj/sub', kind: 'codex', sessionId: 'dead-2' },
      { id: 't-shell', name: 'shell', cwd: '/old/proj', startupCommand: 'npm run dev', shell: '/bin/zsh' },
      { id: 't-failed', name: 'claude2', cwd: '/old/proj', kind: 'claude', sessionId: 'dead-3' },
      { id: 't-reviewer', name: 'rev', cwd: '/old/proj', kind: 'codex', startupCommand: `codex 'Review...'`,
        review: { originTerminalId: 't-claude', phase: 'impl', round: 1, maxRounds: 3, reviewDir: '/old/reviews/x' } }
    ] }
  ]
}

const manifest: ExportManifest = {
  format: 'brain-export', version: 1, exportedAt: 'x', scope: 'group', group,
  sessions: {
    't-claude': { kind: 'claude', file: 'sessions/auth-claude-aaaa.md' },
    't-codex': { kind: 'codex', file: 'sessions/auth-codex-bbbb.md' },
    't-failed': { kind: 'claude', error: 'summarization timed out' }
  }
}

describe('remapCwd', () => {
  it('replaces the old root prefix with the new root', () => {
    expect(remapCwd('/old/proj', '/old/proj', '/new/proj')).toBe('/new/proj')
    expect(remapCwd('/old/proj/sub', '/old/proj', '/new/proj')).toBe('/new/proj/sub')
  })
  it('leaves unrelated paths and "" alone, and is a no-op without a new root', () => {
    expect(remapCwd('/elsewhere', '/old/proj', '/new/proj')).toBe('/elsewhere')
    expect(remapCwd('/old/project-x', '/old/proj', '/new/proj')).toBe('/old/project-x') // prefix is path-segment aware
    expect(remapCwd('', '/old/proj', '/new/proj')).toBe('')
    expect(remapCwd('/old/proj', '/old/proj', null)).toBe('/old/proj')
  })
})

describe('collectCwdCandidates', () => {
  it('returns the distinct remapped cwds, excluding ""', () => {
    expect(collectCwdCandidates(manifest, '/new/proj').sort()).toEqual(['/new/proj', '/new/proj/sub'])
    expect(collectCwdCandidates(manifest, null).sort()).toEqual(['/old/proj', '/old/proj/sub'])
  })
})

describe('buildImport — group scope', () => {
  const build = (exists: (p: string) => boolean, newRoot: string | null = null) =>
    buildImport({ manifest, dir: '/data/imports/abc', newRoot, exists, createId: counterId() })

  it('regenerates every id and never reuses the originals', () => {
    const out = build(() => true)
    expect(out.scope).toBe('group')
    const g = out.group!
    const ids = [g.id, ...g.features.map((f) => f.id), ...g.features.flatMap((f) => f.terminals.map((t) => t.id))]
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^new-/)
    expect(out.terminalIds).toHaveLength(5)
    expect(g.collapsed).toBe(false)
  })

  it('agent with a summary: continue command pointing into the extracted dir; claude gets a fresh pinned id, codex none', () => {
    const out = build(() => true)
    const [claude, codex] = out.group!.features[0].terminals
    expect(claude.startupCommand).toContain(`claude --session-id ${claude.sessionId} '`)
    expect(claude.startupCommand).toContain('/data/imports/abc/sessions/auth-claude-aaaa.md')
    expect(claude.sessionId).toMatch(/^new-/)
    expect(codex.startupCommand).toContain(`codex 'Read /data/imports/abc/sessions/auth-codex-bbbb.md`)
    expect(codex.sessionId).toBeUndefined()
  })

  it('agent without a summary launches fresh; the old sessionId is never carried over', () => {
    const out = build(() => true)
    const failed = out.group!.features[0].terminals[3]
    expect(failed.startupCommand).toBe(`claude --session-id ${failed.sessionId}`)
    expect(failed.sessionId).not.toBe('dead-3')
  })

  it('shells keep startupCommand and shell; reviewers lose their review link and prompt', () => {
    const out = build(() => true)
    const shell = out.group!.features[0].terminals[2]
    expect(shell.startupCommand).toBe('npm run dev')
    expect(shell.shell).toBe('/bin/zsh')
    const reviewer = out.group!.features[0].terminals[4]
    expect(reviewer.review).toBeUndefined()
    expect(reviewer.startupCommand).toBe('codex') // fresh launch, stale review prompt dropped
  })

  it('preserves feature viewMode/gridStyle and remaps cwds; dead cwds fall back to ""', () => {
    const out = build((p) => p === '/new/proj', '/new/proj')
    const f = out.group!.features[0]
    expect(f.viewMode).toBe('grid')
    expect(f.gridStyle).toBe('rows')
    expect(out.group!.cwd).toBe('/new/proj')
    expect(f.terminals[0].cwd).toBe('/new/proj')
    expect(f.terminals[1].cwd).toBe('')   // /new/proj/sub does not exist
  })
})

describe('buildImport — feature scope', () => {
  it('returns the feature plus a fallback group built from the manifest', () => {
    const fm: ExportManifest = {
      format: 'brain-export', version: 1, exportedAt: 'x', scope: 'feature',
      group: { name: 'proj', cwd: '/old/proj' }, feature: group.features[0], sessions: manifest.sessions
    }
    const out = buildImport({ manifest: fm, dir: '/d', newRoot: null, exists: () => true, createId: counterId() })
    expect(out.scope).toBe('feature')
    expect(out.feature!.name).toBe('auth')
    expect(out.feature!.terminals).toHaveLength(5)
    expect(out.fallbackGroup).toEqual({ name: 'proj', cwd: '/old/proj' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/importRemap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/src/importRemap.ts`**

```typescript
import type { Feature, Group, Terminal } from '@shared/types'
import type { ExportManifest } from '@shared/exportTypes'
import { agentContinueCommand, agentLaunchCommand } from './agents'

// Prefix-remap a cwd from the exported root onto the user-picked one.
// Path-segment aware: '/old/proj' rewrites '/old/proj/sub' but not '/old/project-x'.
export function remapCwd(cwd: string, oldRoot: string, newRoot: string | null): string {
  if (!newRoot || !oldRoot || !cwd) return cwd
  if (cwd === oldRoot) return newRoot
  if (cwd.startsWith(oldRoot + '/')) return newRoot + cwd.slice(oldRoot.length)
  return cwd
}

// Every distinct non-'' cwd the import would use, post-remap. The caller checks
// which exist (fs lives in the main process) and feeds the answer to buildImport.
export function collectCwdCandidates(manifest: ExportManifest, newRoot: string | null): string[] {
  const oldRoot = manifest.group.cwd
  const features = manifest.scope === 'group' ? manifest.group.features : [manifest.feature]
  const set = new Set<string>()
  const root = remapCwd(oldRoot, oldRoot, newRoot)
  if (root) set.add(root)
  for (const f of features)
    for (const t of f.terminals) {
      const c = remapCwd(t.cwd, oldRoot, newRoot)
      if (c) set.add(c)
    }
  return [...set]
}

export interface BuiltImport {
  scope: 'group' | 'feature'
  group?: Group       // scope 'group'
  feature?: Feature   // scope 'feature'
  fallbackGroup: { name: string; cwd: string }  // creates a group when the workspace has none
  terminalIds: string[]                          // all fresh ids — the caller spawn-gates them
}

// The pure import transformation: fresh ids everywhere, cwds remapped (dead ones
// fall back to '' = home), review links stripped (their paths are machine-local),
// and agent startup commands rebuilt — continue-from-summary when a summary
// exists, plain fresh launch otherwise. Old sessionIds are never carried over;
// claude terminals get a fresh pinned id so a later restart resumes correctly.
export function buildImport(opts: {
  manifest: ExportManifest
  dir: string                        // absolute dir of the extracted archive
  newRoot: string | null
  exists: (path: string) => boolean
  createId: () => string
}): BuiltImport {
  const { manifest, dir, newRoot, exists, createId } = opts
  const oldRoot = manifest.group.cwd
  const terminalIds: string[] = []

  const fixCwd = (cwd: string): string => {
    const c = remapCwd(cwd, oldRoot, newRoot)
    return c === '' || exists(c) ? c : ''
  }

  const importTerminal = (t: Terminal): Terminal => {
    const id = createId()
    terminalIds.push(id)
    const base: Terminal = { id, name: t.name, cwd: fixCwd(t.cwd) }
    if (t.shell) base.shell = t.shell
    if (t.kind && t.kind !== 'shell') base.kind = t.kind
    if (t.kind === 'claude' || t.kind === 'codex') {
      const session = manifest.sessions[t.id]
      const summaryPath = session?.file ? `${dir}/${session.file}` : null
      const sessionId = t.kind === 'claude' ? createId() : undefined
      if (sessionId) base.sessionId = sessionId
      base.startupCommand = summaryPath
        ? agentContinueCommand(t.kind, summaryPath, sessionId)
        : agentLaunchCommand(t.kind, sessionId)
      return base
    }
    if (t.startupCommand) base.startupCommand = t.startupCommand
    return base
  }

  const importFeature = (f: Feature): Feature => ({
    id: createId(),
    name: f.name,
    collapsed: f.collapsed,
    ...(f.viewMode ? { viewMode: f.viewMode } : {}),
    ...(f.gridStyle ? { gridStyle: f.gridStyle } : {}),
    terminals: f.terminals.map(importTerminal)
  })

  const fallbackGroup = { name: manifest.group.name, cwd: fixCwd(oldRoot) }
  if (manifest.scope === 'feature')
    return { scope: 'feature', feature: importFeature(manifest.feature), fallbackGroup, terminalIds }
  return {
    scope: 'group',
    group: { id: createId(), name: manifest.group.name, cwd: fixCwd(oldRoot), collapsed: false, features: manifest.group.features.map(importFeature) },
    fallbackGroup,
    terminalIds
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/importRemap.test.ts`
Expected: PASS.

> Note on the "agent without a summary launches fresh" assertion: in the test the
> group-scope build creates ids in order — group, feature, then terminals — so the
> exact expected ids are deterministic via the counter. Assertions reference
> `claude.sessionId` etc. rather than hardcoding `new-3`, so the order is free to
> differ; keep it that way.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/src/importRemap.ts src/renderer/src/importRemap.test.ts
git commit -m "feat(import): pure remap of exported structure onto fresh ids/cwds/commands"
```

---

### Task 8: Store insertors — `addImportedGroup` / `addImportedFeature`

**Files:**
- Modify: `src/renderer/src/store.ts`
- Test: `src/renderer/src/store.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `src/renderer/src/store.test.ts`; extend the import from `'./store'` with `addImportedGroup, addImportedFeature`; reuse the file's existing state-building helpers if equivalent ones exist)

```typescript
describe('addImportedGroup / addImportedFeature', () => {
  const importedGroup: Group = {
    id: 'ig', name: 'imported', cwd: '/p', collapsed: false, features: [
      { id: 'if', name: 'auth', collapsed: false, terminals: [{ id: 'it', name: 'claude', cwd: '/p', kind: 'claude' }] }
    ]
  }
  const importedFeature: Feature = {
    id: 'xf', name: 'payments', collapsed: false, terminals: [{ id: 'xt', name: 'codex', cwd: '/p', kind: 'codex' }]
  }

  it('addImportedGroup appends the group and activates its first feature/terminal', () => {
    const s0 = createInitialState()
    const s1 = addImportedGroup(s0, importedGroup)
    expect(s1.workspace.groups.map((g) => g.id)).toContain('ig')
    expect(s1.activeGroupId).toBe('ig')
    expect(s1.activeFeatureId).toBe('if')
    expect(s1.activeTerminalId).toBe('it')
  })

  it('addImportedFeature inserts into the active group and activates it', () => {
    let s = createInitialState()
    s = addGroup(s, 'host', '/host')
    const s1 = addImportedFeature(s, importedFeature, { name: 'fallback', cwd: '/fb' })
    const host = s1.workspace.groups.find((g) => g.name === 'host')!
    expect(host.features.map((f) => f.id)).toContain('xf')
    expect(host.collapsed).toBe(false)
    expect(s1.activeFeatureId).toBe('xf')
    expect(s1.activeTerminalId).toBe('xt')
  })

  it('addImportedFeature creates a group from the fallback when the workspace is empty', () => {
    const s1 = addImportedFeature(createInitialState(), importedFeature, { name: 'fallback', cwd: '/fb' })
    expect(s1.workspace.groups).toHaveLength(1)
    expect(s1.workspace.groups[0]).toMatchObject({ name: 'fallback', cwd: '/fb' })
    expect(s1.workspace.groups[0].features.map((f) => f.id)).toEqual(['xf'])
    expect(s1.activeFeatureId).toBe('xf')
  })
})
```

(If `Group`/`Feature` are not yet imported in the test file, extend its `@shared/types` import.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement in `src/renderer/src/store.ts`** (add after the `moveGroup` function, in the groups section)

```typescript
// ---- import ----------------------------------------------------------------
// Insert an imported group (already carrying fresh ids) and activate it.
export function addImportedGroup(state: AppState, group: Group): AppState {
  const sel = selectFeature(group, state.hidden)
  return {
    ...state,
    workspace: { groups: [...state.workspace.groups, group] },
    activeGroupId: group.id,
    activeFeatureId: sel.featureId,
    activeTerminalId: sel.terminalId
  }
}

// Insert an imported feature into the active group (fallback: first group; an
// empty workspace gets a group built from the export's own name/cwd).
export function addImportedFeature(state: AppState, feature: Feature, fallback: { name: string; cwd: string }): AppState {
  const target = getActiveGroup(state) ?? state.workspace.groups[0] ?? null
  const first = feature.terminals[0]?.id ?? null
  if (!target) {
    const group: Group = { id: createId(), name: fallback.name, cwd: fallback.cwd, collapsed: false, features: [feature] }
    return { ...state, workspace: { groups: [group] }, activeGroupId: group.id, activeFeatureId: feature.id, activeTerminalId: first }
  }
  return {
    ...state,
    workspace: mapGroup(state.workspace, target.id, (g) => ({ ...g, collapsed: false, features: [...g.features, feature] })),
    activeGroupId: target.id,
    activeFeatureId: feature.id,
    activeTerminalId: first
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(import): store insertors for imported groups and features"
```

---

### Task 9: Sidebar — export menu items, feature context menu, Import button

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Test: `src/renderer/src/components/Sidebar.test.tsx` (append)

- [ ] **Step 1: Write the failing tests** (append to `Sidebar.test.tsx`; ALSO add the three new props to the `renderSidebar` base-props object — `onExportGroup: noop as (id: string) => void` style is unnecessary, plain `noop` works: `onExportGroup: noop, onExportFeature: noop, onImport: noop`)

```typescript
describe('export / import entry points', () => {
  it('group context menu offers Export project…', async () => {
    const onExportGroup = vi.fn()
    const { container } = renderSidebar({ onExportGroup })
    fireEvent.contextMenu(container.querySelector('[data-group-id="g1"]')!)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Export project…' }))
    expect(onExportGroup).toHaveBeenCalledWith('g1')
  })

  it('feature row opens a context menu with Export feature…', async () => {
    const onExportFeature = vi.fn()
    const { container } = renderSidebar({ onExportFeature })
    fireEvent.contextMenu(container.querySelector('[data-feature-id="f1"]')!)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Export feature…' }))
    expect(onExportFeature).toHaveBeenCalledWith('f1')
  })

  it('footer has an Import button', async () => {
    const onImport = vi.fn()
    renderSidebar({ onImport })
    await userEvent.click(screen.getByRole('button', { name: 'Import project or feature' }))
    expect(onImport).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: the three new tests FAIL (menu item / button not found); existing tests still pass.

- [ ] **Step 3: Implement in `Sidebar.tsx`**

3a. Add to the props type (after `onOpenInFiles`):

```typescript
  onExportGroup: (groupId: string) => void
  onExportFeature: (featureId: string) => void
  onImport: () => void
```

…and to the destructuring (same line as `onOpenInFiles`): `onExportGroup, onExportFeature, onImport`.

3b. Add feature-menu state next to the existing `menu`/`termMenu` state:

```typescript
  const [featMenu, setFeatMenu] = useState<{ x: number; y: number; featureId: string } | null>(null)
```

3c. On the feature row div (the one with `data-feature-id={f.id}`, next to its `onDragEnd={clearDrag}`), add:

```typescript
  onContextMenu={(e) => { e.preventDefault(); setFeatMenu({ x: e.clientX, y: e.clientY, featureId: f.id }) }}
```

3d. In the group ContextMenu items, insert between Rename and Open in Files:

```typescript
  { label: 'Export project…', onSelect: () => onExportGroup(g.id) },
```

3e. Render the feature menu next to the existing `{termMenu && ...}` block:

```tsx
  {featMenu && (
    <ContextMenu x={featMenu.x} y={featMenu.y} onClose={() => setFeatMenu(null)} items={[
      { label: 'Export feature…', onSelect: () => onExportFeature(featMenu.featureId) }
    ]} />
  )}
```

3f. Replace the footer (`<div className="p-2 border-t border-line">` with the New Project button) with:

```tsx
  <div className="p-2 border-t border-line flex gap-2">
    <button aria-label="New Project" onClick={onAddGroup}
      className="flex-1 rounded-md border border-dashed border-divider bg-transparent px-2 py-1 text-xs text-fg-muted outline-none transition hover:border-accent hover:text-accent">
      + New Project
    </button>
    <button aria-label="Import project or feature" title="Import an exported project/feature zip" onClick={onImport}
      className="rounded-md border border-dashed border-divider bg-transparent px-2 py-1 text-xs text-fg-muted outline-none transition hover:border-accent hover:text-accent">
      Import…
    </button>
  </div>
```

- [ ] **Step 4: Run the Sidebar tests**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: PASS (new and existing).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(export): sidebar entry points — context menus and Import button"
```

---

### Task 10: `ExportToast` component

**Files:**
- Create: `src/renderer/src/components/ExportToast.tsx`
- Test: `src/renderer/src/components/ExportToast.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/ExportToast.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportToast } from './ExportToast'

describe('ExportToast', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ExportToast progress={null} notice={null} onDismiss={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows summarization progress', () => {
    render(<ExportToast progress={{ done: 1, total: 3, current: 'auth/claude' }} notice={null} onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Summarizing sessions 1/3 — auth/claude')
  })

  it('shows a dismissible notice when done', async () => {
    const onDismiss = vi.fn()
    render(<ExportToast progress={null} notice="Exported to /tmp/x.zip" onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('Exported to /tmp/x.zip')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('progress wins over a stale notice', () => {
    render(<ExportToast progress={{ done: 0, total: 2, current: '' }} notice="old" onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Summarizing sessions 0/2')
    expect(screen.queryByText('old')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/components/ExportToast.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderer/src/components/ExportToast.tsx`**

```tsx
import type { ExportProgress } from '@shared/exportTypes'
import { SpinnerIcon } from './icons'

// Bottom-right toast for export/import: live summarization progress while an
// export runs, then a dismissible result line (also reused for import results).
export function ExportToast({ progress, notice, onDismiss }: {
  progress: ExportProgress | null
  notice: string | null
  onDismiss: () => void
}) {
  if (!progress && !notice) return null
  return (
    <div role="status" className="fixed bottom-3 right-3 z-50 flex max-w-md items-center gap-2 rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg shadow-xl shadow-black/50">
      {progress ? (
        <>
          <SpinnerIcon className="shrink-0 text-accent" />
          <span className="truncate">
            Summarizing sessions {progress.done}/{progress.total}{progress.current ? ` — ${progress.current}` : ''}
          </span>
        </>
      ) : (
        <>
          <span className="min-w-0 break-words">{notice}</span>
          <button aria-label="Dismiss" onClick={onDismiss} className="shrink-0 px-1 text-fg-muted transition hover:text-fg">✕</button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/components/ExportToast.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/renderer/src/components/ExportToast.tsx src/renderer/src/components/ExportToast.test.tsx
git commit -m "feat(export): progress/result toast"
```

---

### Task 11: App wiring

**Files:**
- Modify: `src/renderer/src/App.tsx`

Wiring of already-tested parts; the gate is typecheck + full suite + the manual smoke test in Task 12.

- [ ] **Step 1: Add imports to `App.tsx`**

Extend the store import (line ~7-12) with `addImportedGroup, addImportedFeature`. Add:

```typescript
import { collectCwdCandidates, buildImport } from './importRemap'
import { ExportToast } from './components/ExportToast'
import type { ExportProgress, ExportRunResult } from '@shared/exportTypes'
```

- [ ] **Step 2: Add state + progress subscription** (next to the other `useState`/`useEffect` blocks at the top of `App()`)

```typescript
  // Export/import feedback: live progress while the main process summarizes
  // sessions, then a dismissible result notice (shared with import results).
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  useEffect(() => window.brain.onExportProgress(setExportProgress), [])
```

- [ ] **Step 3: Add the handlers** (next to `launchAgent`/`createGroup`)

```typescript
  const finishExport = (res: ExportRunResult) => {
    setExportProgress(null)
    if (res.canceled) return
    setExportNotice(res.ok
      ? `Exported to ${res.path}${res.warnings.length ? ` — ${res.warnings.length} session(s) without summary: ${res.warnings.join('; ')}` : ''}`
      : `Export failed: ${res.warnings.join('; ') || 'unknown error'}`)
  }
  const exportGroup = (groupId: string) => {
    const g = state.workspace.groups.find((x) => x.id === groupId)
    if (g) void window.brain.exportArchive({ scope: 'group', group: g }).then(finishExport)
  }
  const exportFeature = (featureId: string) => {
    const g = state.workspace.groups.find((x) => x.features.some((f) => f.id === featureId))
    const f = g?.features.find((x) => x.id === featureId)
    if (g && f) void window.brain.exportArchive({ scope: 'feature', group: { name: g.name, cwd: g.cwd }, feature: f }).then(finishExport)
  }
  const importArchive = async () => {
    const res = await window.brain.importArchive()
    if (res.canceled) return
    if (res.error || !res.manifest || !res.dir) {
      setExportNotice(`Import failed: ${res.error ?? 'unknown error'}`)
      return
    }
    // Old root missing on this machine → let the user point at the new one.
    // Canceling the picker just means every dead cwd falls back to home.
    const newRoot = res.cwdExists ? null : await window.brain.pickDirectory()
    const candidates = collectCwdCandidates(res.manifest, newRoot)
    const found = await window.brain.pathsExist(candidates)
    const existing = new Set(candidates.filter((_, i) => found[i]))
    const built = buildImport({
      manifest: res.manifest, dir: res.dir, newRoot,
      exists: (p) => existing.has(p), createId
    })
    // Imported terminals must stay cold until explicitly opened — without this,
    // adding them mid-session would auto-spawn every agent at once (spawnGate
    // treats non-boot ids as user-created). Must happen BEFORE the state update.
    for (const id of built.terminalIds) bootIdsRef.current.add(id)
    if (built.scope === 'group' && built.group) {
      const g = built.group
      apply((s) => addImportedGroup(s, g))
      setExportNotice(`Imported project "${g.name}" — open a terminal to continue its session`)
    } else if (built.feature) {
      const f = built.feature
      apply((s) => addImportedFeature(s, f, built.fallbackGroup))
      setExportNotice(`Imported feature "${f.name}" — open a terminal to continue its session`)
    }
  }
```

- [ ] **Step 4: Pass the new props to `<Sidebar …>`** (after `onOpenInFiles={…}`)

```tsx
        onExportGroup={exportGroup}
        onExportFeature={exportFeature}
        onImport={() => void importArchive()}
```

- [ ] **Step 5: Render the toast** (just before the closing `</div>` of the root, next to the dialogs)

```tsx
      <ExportToast progress={exportProgress} notice={exportNotice} onDismiss={() => setExportNotice(null)} />
```

- [ ] **Step 6: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(export): wire export/import flows into the app"
```

---

### Task 12: Manual smoke test + finish

- [ ] **Step 1: Manual smoke test**

Run: `npm run dev`, then in the app:

1. Pick (or create) a project with at least one claude terminal that has a real session (`sessionId` present in `~/.config/Brain/userData/workspace.json`).
2. Right-click the project → **Export project…** → save to `/tmp/test-export.zip`. Watch the toast count up; on finish, check `unzip -l /tmp/test-export.zip` shows `manifest.json` + `sessions/*.md`, and `unzip -p /tmp/test-export.zip manifest.json | head -50` looks right.
3. Click **Import…** → pick the zip. A new project appears in the sidebar (fresh ids; verify nothing auto-spawns).
4. Open the imported claude terminal: it must launch with the continue prompt and read the summary .md.
5. Right-click a feature → **Export feature…** → re-import → lands in the ACTIVE project.
6. Negative path: `echo hi > /tmp/not-a-zip.zip` → Import… → toast shows "Import failed: Not a readable zip archive".

Expected: all six pass. Fix anything that doesn't before proceeding.

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 3: Finish the branch**

Use the superpowers:finishing-a-development-branch skill. Per the user's workflow: merge `feature/export-import` into `master` with `--no-ff` — and **ask the user before pushing**.

---

## Known accepted limitations (from the spec — do not "fix" silently)

- An imported claude terminal that is never opened, after an app restart, resumes via `claude --resume <pinned-id>` which fails (the session was never created). This mirrors the existing behavior of never-started reviewer terminals; acceptable.
- Imported codex terminals have no session capture until restarted (then `codex resume --last`), same as legacy terminals.
- Extracted archives under `userData/imports/` are never cleaned up (session summaries stay referenced by startup commands).
- `manifest.sessions` is keyed by ORIGINAL terminal ids; after import those ids exist only inside the manifest/dir on disk, never in the workspace.

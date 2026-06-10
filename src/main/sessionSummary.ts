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

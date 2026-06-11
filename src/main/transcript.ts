import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'
import { codexSessionsDir, newestSessionDirs } from './codexSession'

// Claude Code stores per-project session transcripts under
// ~/.claude/projects/<cwd-with-slashes-as-dashes>/<session>.jsonl
// (e.g. /home/miljan/terminaltor → -home-miljan-terminaltor).
export function claudeProjectDir(home: string, cwd: string): string {
  return join(home, '.claude', 'projects', cwd.replace(/\//g, '-'))
}

async function newestJsonlEntry(dir: string): Promise<{ path: string; mtimeMs: number } | null> {
  let entries: import('fs').Dirent[]
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return null }
  let best: { path: string; mtimeMs: number } | null = null
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
    const full = join(dir, e.name)
    try {
      const st = await fs.stat(full)
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: st.mtimeMs }
    } catch { /* skip unreadable */ }
  }
  return best
}

// Newest *.jsonl directly inside `dir`, or null if the dir is missing/empty.
export async function newestJsonl(dir: string): Promise<string | null> {
  return (await newestJsonlEntry(dir))?.path ?? null
}

// Codex rollouts live under ~/.codex/sessions/YYYY/MM/DD/ — walk the newest day
// dirs and take the freshest rollout overall. Comparing mtimes ACROSS dirs
// matters: `codex resume` appends to the original file, so the most recently
// used session can sit in an older day's directory.
async function newestCodexRollout(home: string): Promise<string | null> {
  const dirs = await newestSessionDirs(codexSessionsDir(home))
  let best: { path: string; mtimeMs: number } | null = null
  for (const dir of dirs) {
    const e = await newestJsonlEntry(dir)
    if (e && (!best || e.mtimeMs > best.mtimeMs)) best = e
  }
  return best?.path ?? null
}

// Best-effort discovery of the origin agent's transcript. Claude is precise
// (per-cwd project dir); codex is a newest-session fallback. Returns null
// when nothing is found — the caller falls back to a manual intent note.
export async function resolveTranscript(opts: { home?: string; cwd: string; kind?: string }): Promise<string | null> {
  const home = opts.home ?? homedir()
  if (opts.kind === 'codex') return newestCodexRollout(home)
  return newestJsonl(claudeProjectDir(home, opts.cwd))
}

// Whether the claude conversation a restored terminal would resume still
// exists: the exact <sessionId>.jsonl when an id is pinned, else any session
// in the cwd's project dir (the `--continue` target). Missing → the caller
// falls back to a fresh conversation instead of spawning a doomed resume.
export async function claudeSessionExists(opts: { home?: string; cwd: string; sessionId?: string }): Promise<boolean> {
  const home = opts.home ?? homedir()
  const dir = claudeProjectDir(home, opts.cwd)
  if (opts.sessionId) {
    try { await fs.access(join(dir, `${opts.sessionId}.jsonl`)); return true } catch { return false }
  }
  return (await newestJsonl(dir)) !== null
}

import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'

// Claude Code stores per-project session transcripts under
// ~/.claude/projects/<cwd-with-slashes-as-dashes>/<session>.jsonl
// (e.g. /home/miljan/terminaltor → -home-miljan-terminaltor).
export function claudeProjectDir(home: string, cwd: string): string {
  return join(home, '.claude', 'projects', cwd.replace(/\//g, '-'))
}

// Newest *.jsonl directly inside `dir`, or null if the dir is missing/empty.
export async function newestJsonl(dir: string): Promise<string | null> {
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
  return best?.path ?? null
}

// Best-effort discovery of the origin agent's transcript. Claude is precise
// (per-cwd project dir); codex is a flat newest-session fallback. Returns null
// when nothing is found — the caller falls back to a manual intent note.
export async function resolveTranscript(opts: { home?: string; cwd: string; kind?: string }): Promise<string | null> {
  const home = opts.home ?? homedir()
  if (opts.kind === 'codex') return newestJsonl(join(home, '.codex', 'sessions'))
  return newestJsonl(claudeProjectDir(home, opts.cwd))
}

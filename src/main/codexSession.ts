import { homedir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'

// Codex can't be told which session id to use at launch (unlike claude's
// --session-id), so to remember a specific terminal's conversation we detect the
// rollout file it writes. Sessions live under ~/.codex/sessions/YYYY/MM/DD/
// rollout-<localtimestamp>-<uuid>.jsonl, and the first line is a `session_meta`
// record carrying the canonical id and the cwd:
//   {"type":"session_meta","payload":{"id":"<uuid>","cwd":"/abs/path",...}}

export function codexSessionsDir(home: string = homedir()): string {
  return join(home, '.codex', 'sessions')
}

// The id + cwd from a rollout file's first (session_meta) line, or null if the
// line isn't there yet / isn't valid JSON (a brand-new file may be momentarily
// empty — the caller just retries on the next poll).
export function parseSessionMeta(firstLine: string): { id: string; cwd: string } | null {
  try {
    const rec = JSON.parse(firstLine)
    const p = rec?.type === 'session_meta' ? rec.payload : null
    if (p && typeof p.id === 'string' && typeof p.cwd === 'string') return { id: p.id, cwd: p.cwd }
  } catch { /* not written yet / partial */ }
  return null
}

async function sortedSubdirsDesc(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()
  } catch { return [] }
}

// The newest few leaf (day) directories, descending. Walks years→months→days
// newest-first and stops once `limit` are collected; crossing month/year
// boundaries naturally (a fresh session is always in the most-recent day dir, so
// the extra dir is only a midnight-rollover safety net).
export async function newestSessionDirs(root: string, limit = 2): Promise<string[]> {
  const days: string[] = []
  for (const y of await sortedSubdirsDesc(root)) {
    for (const m of await sortedSubdirsDesc(join(root, y))) {
      for (const d of await sortedSubdirsDesc(join(root, y, m))) {
        days.push(join(root, y, m, d))
        if (days.length >= limit) return days
      }
    }
  }
  return days
}

async function firstLine(path: string): Promise<string> {
  // Sessions grow large; only the first line holds the meta, so read a bounded
  // prefix rather than the whole file (the session_meta record is well under 64K).
  const fh = await fs.open(path, 'r')
  try {
    const { bytesRead, buffer } = await fh.read({ buffer: Buffer.alloc(65536), position: 0 })
    const text = buffer.toString('utf8', 0, bytesRead)
    const nl = text.indexOf('\n')
    return nl === -1 ? text : text.slice(0, nl)
  } finally {
    await fh.close()
  }
}

// The id of the newest unclaimed codex rollout for `cwd` that was (re)written at
// or after `sinceMs`. Returns null when nothing matches — the caller polls until
// codex has written the file or the capture window elapses.
export async function findCodexSessionId(opts: {
  root: string
  cwd: string
  sinceMs: number
  claimed: Set<string>
}): Promise<string | null> {
  const { root, cwd, sinceMs, claimed } = opts
  const SLACK_MS = 2000 // tolerate clock/mtime jitter around the launch instant
  const dirs = await newestSessionDirs(root)
  const candidates: { id: string; mtimeMs: number }[] = []
  for (const dir of dirs) {
    let names: string[]
    try { names = await fs.readdir(dir) } catch { continue }
    for (const name of names) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
      const full = join(dir, name)
      let mtimeMs: number
      try { mtimeMs = (await fs.stat(full)).mtimeMs } catch { continue }
      if (mtimeMs < sinceMs - SLACK_MS) continue
      let meta: { id: string; cwd: string } | null
      try { meta = parseSessionMeta(await firstLine(full)) } catch { continue }
      if (!meta || meta.cwd !== cwd || claimed.has(meta.id)) continue
      candidates.push({ id: meta.id, mtimeMs })
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return candidates[0]?.id ?? null
}

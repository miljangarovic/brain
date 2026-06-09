import { promises as fs } from 'fs'
import { join } from 'path'
import type { ReviewPhase } from '@shared/types'

export interface MdEntry { path: string; mtimeMs: number }

const IGNORE = new Set(['node_modules', '.git', 'release', 'out', 'dist', '.idea'])

export function pickNewest(entries: MdEntry[]): string | null {
  if (entries.length === 0) return null
  return entries.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a)).path
}

export async function scanMarkdown(root: string, maxDepth = 4): Promise<MdEntry[]> {
  const out: MdEntry[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries: import('fs').Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') { if (IGNORE.has(e.name)) continue }
      if (e.isDirectory()) {
        if (IGNORE.has(e.name)) continue
        await walk(join(dir, e.name), depth + 1)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const full = join(dir, e.name)
        try { const st = await fs.stat(full); out.push({ path: full, mtimeMs: st.mtimeMs }) } catch { /* skip */ }
      }
    }
  }
  await walk(root, 0)
  return out
}

export async function suggestSpec(cwd: string): Promise<string | null> {
  return pickNewest(await scanMarkdown(cwd))
}

export function reviewDirFor(userDataDir: string, originTerminalId: string): string {
  return join(userDataDir, 'reviews', originTerminalId)
}

export function reviewFilePath(reviewDir: string, phase: ReviewPhase, round: number): string {
  return join(reviewDir, `review-${phase}-${round}.md`)
}

export async function resolveReviewPaths(
  userDataDir: string, originTerminalId: string, phase: ReviewPhase, round: number
): Promise<{ reviewDir: string; reviewFile: string; intentPath: string; specPath: string }> {
  const reviewDir = reviewDirFor(userDataDir, originTerminalId)
  await fs.mkdir(reviewDir, { recursive: true })
  return {
    reviewDir,
    reviewFile: reviewFilePath(reviewDir, phase, round),
    intentPath: join(reviewDir, 'intent.md'),
    specPath: join(reviewDir, 'spec.md')
  }
}

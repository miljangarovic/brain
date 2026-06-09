import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { claudeProjectDir, newestJsonl, resolveTranscript } from './transcript'

const mktmp = async () => {
  const dir = join(tmpdir(), `ttor-tr-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

describe('claudeProjectDir', () => {
  it('encodes cwd by replacing slashes with dashes under ~/.claude/projects', () => {
    expect(claudeProjectDir('/home/me', '/home/me/proj')).toBe(
      join('/home/me', '.claude', 'projects', '-home-me-proj')
    )
  })
})

describe('newestJsonl', () => {
  it('returns null for a missing directory', async () => {
    expect(await newestJsonl(join(tmpdir(), 'does-not-exist-xyz'))).toBeNull()
  })
  it('returns the newest .jsonl and ignores other files', async () => {
    const dir = await mktmp()
    await fs.writeFile(join(dir, 'old.jsonl'), '{}', 'utf8')
    await fs.writeFile(join(dir, 'note.txt'), 'x', 'utf8')
    await new Promise((r) => setTimeout(r, 10))
    await fs.writeFile(join(dir, 'new.jsonl'), '{}', 'utf8')
    expect(await newestJsonl(dir)).toBe(join(dir, 'new.jsonl'))
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('resolveTranscript', () => {
  it('finds the newest claude session for the cwd', async () => {
    const home = await mktmp()
    const proj = claudeProjectDir(home, '/work/app')
    await fs.mkdir(proj, { recursive: true })
    await fs.writeFile(join(proj, 's1.jsonl'), '{}', 'utf8')
    expect(await resolveTranscript({ home, cwd: '/work/app' })).toBe(join(proj, 's1.jsonl'))
    await fs.rm(home, { recursive: true, force: true })
  })
  it('returns null when there is no session for the cwd', async () => {
    const home = await mktmp()
    expect(await resolveTranscript({ home, cwd: '/work/none' })).toBeNull()
    await fs.rm(home, { recursive: true, force: true })
  })
})

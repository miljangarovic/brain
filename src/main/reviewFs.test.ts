import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pickNewest, scanMarkdown, suggestSpec, reviewDirFor, reviewFilePath, resolveReviewPaths } from './reviewFs'

const mktmp = async () => {
  const dir = join(tmpdir(), `ttor-rev-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

describe('pickNewest', () => {
  it('returns null on empty', () => expect(pickNewest([])).toBeNull())
  it('returns the entry with greatest mtimeMs', () => {
    expect(pickNewest([{ path: 'a', mtimeMs: 1 }, { path: 'b', mtimeMs: 9 }, { path: 'c', mtimeMs: 3 }])).toBe('b')
  })
})

describe('reviewDirFor / reviewFilePath', () => {
  it('keys the dir by origin id under reviews/', () => {
    expect(reviewDirFor('/data', 'abc')).toBe(join('/data', 'reviews', 'abc'))
  })
  it('names review files review-<phase>-<round>.md', () => {
    expect(reviewFilePath('/data/reviews/abc', 'spec', 2)).toBe(join('/data/reviews/abc', 'review-spec-2.md'))
  })
})

describe('scanMarkdown', () => {
  it('finds .md files and ignores node_modules/.git', async () => {
    const root = await mktmp()
    await fs.writeFile(join(root, 'spec.md'), '#', 'utf8')
    await fs.mkdir(join(root, 'node_modules', 'x'), { recursive: true })
    await fs.writeFile(join(root, 'node_modules', 'x', 'readme.md'), '#', 'utf8')
    const found = (await scanMarkdown(root)).map((e) => e.path)
    expect(found).toContain(join(root, 'spec.md'))
    expect(found.some((p) => p.includes('node_modules'))).toBe(false)
    await fs.rm(root, { recursive: true, force: true })
  })
})

describe('suggestSpec', () => {
  it('returns newest .md or null', async () => {
    const root = await mktmp()
    await fs.writeFile(join(root, 'old.md'), '#', 'utf8')
    await new Promise((r) => setTimeout(r, 10))
    await fs.writeFile(join(root, 'new.md'), '#', 'utf8')
    expect(await suggestSpec(root)).toBe(join(root, 'new.md'))
    await fs.rm(root, { recursive: true, force: true })
  })
  it('returns null when no markdown', async () => {
    const root = await mktmp()
    expect(await suggestSpec(root)).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })
})

describe('resolveReviewPaths', () => {
  it('mkdir -p the review dir and returns review/intent/spec paths', async () => {
    const base = await mktmp()
    const { reviewDir, reviewFile, intentPath, specPath } = await resolveReviewPaths(base, 'tid', 'intent', 1)
    expect(reviewDir).toBe(join(base, 'reviews', 'tid'))
    expect(reviewFile).toBe(join(base, 'reviews', 'tid', 'review-intent-1.md'))
    expect(intentPath).toBe(join(base, 'reviews', 'tid', 'intent.md'))
    expect(specPath).toBe(join(base, 'reviews', 'tid', 'spec.md'))
    const stat = await fs.stat(reviewDir)
    expect(stat.isDirectory()).toBe(true)
    await fs.rm(base, { recursive: true, force: true })
  })
})

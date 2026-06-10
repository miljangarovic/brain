import { describe, it, expect } from 'vitest'
import { findPathCandidates } from './termLinks'

describe('findPathCandidates', () => {
  it('finds an absolute path with a :line:col suffix', () => {
    const text = 'error at /home/u/app/src/x.ts:42:7 during build'
    const [c] = findPathCandidates(text)
    expect(c.path).toBe('/home/u/app/src/x.ts')
    expect(c.line).toBe(42)
    expect(text.slice(c.start, c.end)).toBe('/home/u/app/src/x.ts:42:7')
  })

  it('finds a relative path with directories', () => {
    const text = 'pogledaj src/main/ipc.ts za detalje'
    const [c] = findPathCandidates(text)
    expect(c.path).toBe('src/main/ipc.ts')
    expect(text.slice(c.start, c.end)).toBe('src/main/ipc.ts')
  })

  it('finds ./, ../ and ~/ paths', () => {
    expect(findPathCandidates('run ./scripts/dev.sh now')[0].path).toBe('./scripts/dev.sh')
    expect(findPathCandidates('vidi ../shared/types.ts')[0].path).toBe('../shared/types.ts')
    expect(findPathCandidates('u ~/notes.md stoji')[0].path).toBe('~/notes.md')
  })

  it('finds a bare filename with an extension', () => {
    const [c] = findPathCandidates('izmeni package.json i probaj opet')
    expect(c.path).toBe('package.json')
  })

  it('strips surrounding quotes/backticks and trailing sentence punctuation', () => {
    expect(findPathCandidates("otvori 'src/a.ts' odmah")[0].path).toBe('src/a.ts')
    expect(findPathCandidates('vidi `src/b.ts`')[0].path).toBe('src/b.ts')
    expect(findPathCandidates('sve je u src/c.ts.')[0].path).toBe('src/c.ts')
    expect(findPathCandidates('fajlovi (src/d.ts, src/e.ts)').map((c) => c.path)).toEqual(['src/d.ts', 'src/e.ts'])
  })

  it('parses a :line suffix without a column', () => {
    const [c] = findPathCandidates('see src/a.ts:123')
    expect(c.line).toBe(123)
    expect(c.path).toBe('src/a.ts')
  })

  it('ignores URLs', () => {
    expect(findPathCandidates('docs: https://example.com/a/b.html')).toEqual([])
  })

  it('ignores times and version numbers', () => {
    expect(findPathCandidates('u 12:30 stize v2.1.9')).toEqual([])
  })

  it('returns every candidate with correct positions', () => {
    const text = 'diff src/a.ts src/b.ts'
    const cands = findPathCandidates(text)
    expect(cands.map((c) => c.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(cands.map((c) => text.slice(c.start, c.end))).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('returns nothing for plain prose', () => {
    expect(findPathCandidates('sve radi kako treba')).toEqual([])
  })
})

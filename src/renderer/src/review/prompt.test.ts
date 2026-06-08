import { describe, it, expect } from 'vitest'
import {
  shellSingleQuote, buildReviewerCommand,
  reviewerPrompt, relayToOriginPrompt, reReviewPrompt
} from './prompt'

describe('shellSingleQuote', () => {
  it('wraps in single quotes', () => {
    expect(shellSingleQuote('abc')).toBe(`'abc'`)
  })
  it('escapes embedded single quotes', () => {
    expect(shellSingleQuote("a'b")).toBe(`'a'\\''b'`)
  })
})

describe('buildReviewerCommand', () => {
  it('joins agent command with quoted prompt', () => {
    expect(buildReviewerCommand('claude', 'hi')).toBe(`claude 'hi'`)
  })
})

describe('reviewerPrompt', () => {
  it('spec: references spec path, review file and intent', () => {
    const p = reviewerPrompt({ kind: 'spec', specPath: '/a/spec.md', reviewFile: '/r/review-1.md', intent: 'auth flow' })
    expect(p).toContain('/a/spec.md')
    expect(p).toContain('/r/review-1.md')
    expect(p).toContain('auth flow')
    expect(p).toContain('WRITE')
  })
  it('spec without intent uses fallback wording', () => {
    const p = reviewerPrompt({ kind: 'spec', specPath: '/a/spec.md', reviewFile: '/r/review-1.md' })
    expect(p).toContain('infer it from')
  })
  it('impl: references git diff and review file, not a spec path', () => {
    const p = reviewerPrompt({ kind: 'impl', reviewFile: '/r/review-1.md' })
    expect(p).toContain('git diff')
    expect(p).toContain('/r/review-1.md')
  })
})

describe('relayToOriginPrompt', () => {
  it('spec: single line pointing at review file + spec path', () => {
    const p = relayToOriginPrompt({ kind: 'spec', reviewFile: '/r/review-1.md', specPath: '/a/spec.md' })
    expect(p).toContain('/r/review-1.md')
    expect(p).toContain('/a/spec.md')
    expect(p).not.toContain('\n')
  })
  it('impl: single line, mentions not to commit', () => {
    const p = relayToOriginPrompt({ kind: 'impl', reviewFile: '/r/review-1.md' })
    expect(p).toContain('/r/review-1.md')
    expect(p).toContain('commit')
    expect(p).not.toContain('\n')
  })
})

describe('reReviewPrompt', () => {
  it('spec: single line, new review file', () => {
    const p = reReviewPrompt({ kind: 'spec', specPath: '/a/spec.md', reviewFile: '/r/review-2.md' })
    expect(p).toContain('/r/review-2.md')
    expect(p).toContain('/a/spec.md')
    expect(p).not.toContain('\n')
  })
})

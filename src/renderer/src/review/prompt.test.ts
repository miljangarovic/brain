import { describe, it, expect } from 'vitest'
import {
  buildReviewerCommand,
  reviewerStartupPrompt, reviewerInjectPrompt, relayToOriginPrompt
} from './prompt'
import { shellSingleQuote } from '../shellQuote'

describe('shellSingleQuote', () => {
  it('wraps in single quotes', () => expect(shellSingleQuote('abc')).toBe(`'abc'`))
  it('escapes embedded single quotes', () => expect(shellSingleQuote("a'b")).toBe(`'a'\\''b'`))
})

describe('buildReviewerCommand', () => {
  it('joins agent command with quoted prompt', () =>
    expect(buildReviewerCommand('claude', 'hi')).toBe(`claude 'hi'`))
})

describe('reviewerStartupPrompt', () => {
  it('intent: references the transcript + review file + VERDICT contract', () => {
    const p = reviewerStartupPrompt({ phase: 'intent', round: 1, reviewFile: '/r/review-intent-1.md', transcriptPath: '/t/s.jsonl' })
    expect(p).toContain('/t/s.jsonl')
    expect(p).toContain('/r/review-intent-1.md')
    expect(p).toContain('VERDICT: APPROVED')
    expect(p).toContain('VERDICT: NEEDS-WORK')
  })
  it('spec: references the spec path and the intent path', () => {
    const p = reviewerStartupPrompt({ phase: 'spec', round: 1, reviewFile: '/r/review-spec-1.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p).toContain('/a/spec.md')
    expect(p).toContain('/r/intent.md')
  })
  it('impl: references git diff, intent and spec', () => {
    const p = reviewerStartupPrompt({ phase: 'impl', round: 1, reviewFile: '/r/review-impl-1.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p).toContain('git diff')
    expect(p).toContain('/a/spec.md')
    expect(p).toContain('/r/intent.md')
  })
  it('impl: falls back to reviewing committed work when the tree is clean', () => {
    // An origin that commits per-task leaves a clean tree — without the
    // fallback a literal reviewer reports "empty diff" and blocks on nothing.
    const p = reviewerStartupPrompt({ phase: 'impl', round: 1, reviewFile: '/r/review-impl-1.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p.toLowerCase()).toContain('clean')
    expect(p).toContain('git log')
  })
  it('round > 1 adds a re-review preamble', () => {
    const p = reviewerStartupPrompt({ phase: 'spec', round: 2, reviewFile: '/r/review-spec-2.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p.toLowerCase()).toContain('revised')
  })
  it('never emits the literal "undefined" when optional paths are omitted', () => {
    expect(reviewerStartupPrompt({ phase: 'impl', round: 1, reviewFile: '/r/review-impl-1.md' })).not.toContain('undefined')
    expect(reviewerStartupPrompt({ phase: 'spec', round: 1, reviewFile: '/r/review-spec-1.md' })).not.toContain('undefined')
  })
})

describe('reviewerInjectPrompt', () => {
  it('is a single line (safe to write into an agent PTY)', () => {
    const p = reviewerInjectPrompt({ phase: 'spec', round: 2, reviewFile: '/r/review-spec-2.md', specPath: '/a/spec.md', intentPath: '/r/intent.md' })
    expect(p).not.toContain('\n')
    expect(p).toContain('/r/review-spec-2.md')
  })
})

describe('relayToOriginPrompt', () => {
  it('intent: points at the critique and the intent document, single line', () => {
    const p = relayToOriginPrompt({ phase: 'intent', reviewFile: '/r/review-intent-1.md', intentPath: '/r/intent.md' })
    expect(p).toContain('/r/review-intent-1.md')
    expect(p).toContain('/r/intent.md')
    expect(p).not.toContain('\n')
  })
  it('spec: points at the spec path, single line', () => {
    const p = relayToOriginPrompt({ phase: 'spec', reviewFile: '/r/review-spec-1.md', specPath: '/a/spec.md' })
    expect(p).toContain('/a/spec.md')
    expect(p).not.toContain('\n')
  })
  it('impl: mentions not to commit, single line', () => {
    const p = relayToOriginPrompt({ phase: 'impl', reviewFile: '/r/review-impl-1.md' })
    expect(p).toContain('commit')
    expect(p).not.toContain('\n')
  })
})

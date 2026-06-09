import { describe, it, expect, beforeEach } from 'vitest'
import { registerTail, unregisterTail, readTail, readXtermTail, type TermLike } from './tailRegistry'

describe('registry', () => {
  beforeEach(() => { unregisterTail('t1') })
  it('reads from a registered reader', () => {
    registerTail('t1', () => 'hello')
    expect(readTail('t1')).toBe('hello')
  })
  it('returns empty string for an unknown id', () => {
    expect(readTail('missing')).toBe('')
  })
  it('returns empty string when a reader throws', () => {
    registerTail('t1', () => { throw new Error('disposed') })
    expect(readTail('t1')).toBe('')
  })
  it('stops reading after unregister', () => {
    registerTail('t1', () => 'x')
    unregisterTail('t1')
    expect(readTail('t1')).toBe('')
  })
})

describe('readXtermTail', () => {
  // Fake the slice of xterm's buffer API we use.
  function fakeTerm(lines: string[], cursorY: number): TermLike {
    return {
      buffer: { active: {
        baseY: 0, cursorY, length: lines.length,
        getLine: (i: number) => (lines[i] === undefined ? undefined : { translateToString: () => lines[i] }),
      } },
    }
  }
  it('returns the last N lines up to the cursor row', () => {
    const term = fakeTerm(['a', 'b', 'c', 'd'], 3)
    expect(readXtermTail(term, 2)).toBe('c\nd')
  })
  it('clamps to the start of the buffer', () => {
    const term = fakeTerm(['a', 'b'], 1)
    expect(readXtermTail(term, 10)).toBe('a\nb')
  })
})

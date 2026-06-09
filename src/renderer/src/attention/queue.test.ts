// src/renderer/src/attention/queue.test.ts
import { describe, it, expect } from 'vitest'
import { upsertItem, removeItem, lastLineOf, type AttentionItem } from './queue'

const item = (terminalId: string, ts: number): AttentionItem =>
  ({ terminalId, state: 'done', lastLine: '', ts })

describe('upsertItem', () => {
  it('adds an item newest-first', () => {
    const q = upsertItem(upsertItem([], item('a', 1)), item('b', 2))
    expect(q.map((x) => x.terminalId)).toEqual(['b', 'a'])
  })
  it('replaces an existing item for the same terminal and re-sorts', () => {
    let q = upsertItem([], item('a', 1))
    q = upsertItem(q, item('b', 2))
    q = upsertItem(q, item('a', 3)) // a moves to the front
    expect(q.map((x) => x.terminalId)).toEqual(['a', 'b'])
    expect(q).toHaveLength(2)
  })
})

describe('removeItem', () => {
  it('drops the item for a terminal', () => {
    const q = removeItem([item('a', 1), item('b', 2)], 'a')
    expect(q.map((x) => x.terminalId)).toEqual(['b'])
  })
})

describe('lastLineOf', () => {
  it('returns the last non-empty trimmed line', () => {
    expect(lastLineOf('foo\n  bar  \n\n')).toBe('bar')
  })
  it('returns empty string for blank input', () => {
    expect(lastLineOf('\n  \n')).toBe('')
  })
})

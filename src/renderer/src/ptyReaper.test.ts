import { describe, it, expect } from 'vitest'
import { removedIds, pruneRecord } from './ptyReaper'

describe('pruneRecord', () => {
  it('drops dead-terminal keys', () => {
    expect(pruneRecord({ a: 1, b: 2, c: 3 }, ['b', 'c'])).toEqual({ a: 1 })
  })
  it('returns the same reference when no key matches (no pointless re-render)', () => {
    const rec = { a: 1 }
    expect(pruneRecord(rec, ['x', 'y'])).toBe(rec)
  })
  it('ignores dead ids that were never tracked', () => {
    expect(pruneRecord({ a: 1, b: 2 }, ['b', 'ghost'])).toEqual({ a: 1 })
  })
})

describe('removedIds', () => {
  it('returns ids present before but gone now (terminals removed from the workspace)', () => {
    expect(removedIds(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b'])
  })

  it('returns nothing when the set is unchanged', () => {
    expect(removedIds(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('returns nothing when terminals are only added (e.g. a reviewer terminal)', () => {
    expect(removedIds(['a'], ['a', 'b'])).toEqual([])
  })

  it('reports every id when all terminals are gone (deleting a group/feature)', () => {
    expect(removedIds(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})

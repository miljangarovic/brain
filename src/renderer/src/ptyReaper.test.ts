import { describe, it, expect } from 'vitest'
import { removedIds } from './ptyReaper'

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

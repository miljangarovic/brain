import { describe, it, expect } from 'vitest'
import { createWorkspace } from './types'

describe('createWorkspace', () => {
  it('returns an empty workspace with a groups array', () => {
    const ws = createWorkspace()
    expect(ws).toEqual({ groups: [] })
  })
})

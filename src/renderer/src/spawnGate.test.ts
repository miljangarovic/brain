import { describe, it, expect } from 'vitest'
import { shouldSpawn } from './spawnGate'

describe('shouldSpawn', () => {
  it('spawns terminals created during the session immediately', () => {
    expect(shouldSpawn('new', new Set(['boot1']), new Set())).toBe(true)
  })
  it('keeps boot-restored terminals cold until manually started', () => {
    expect(shouldSpawn('boot1', new Set(['boot1']), new Set())).toBe(false)
  })
  it('spawns a boot terminal once the user has opened it', () => {
    expect(shouldSpawn('boot1', new Set(['boot1']), new Set(['boot1']))).toBe(true)
  })
})

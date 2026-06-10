import { describe, it, expect } from 'vitest'
import { shouldSpawn, restoredSpawnIds } from './spawnGate'
import type { Feature } from '@shared/types'

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

describe('restoredSpawnIds', () => {
  const feature: Feature = {
    id: 'f', name: 'auth', collapsed: false, terminals: [
      { id: 'tc', name: 'claude', cwd: '/p', kind: 'claude', sessionId: 'cs-1' },
      { id: 'tx', name: 'codex', cwd: '/p', kind: 'codex' },
      { id: 'ts', name: 'shell', cwd: '/p' }
    ]
  }
  it('all terminals go cold (boot); agent terminals also resume', () => {
    expect(restoredSpawnIds(feature)).toEqual({
      bootIds: ['tc', 'tx', 'ts'],
      resumeIds: ['tc', 'tx']
    })
  })
})

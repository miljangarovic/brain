// src/renderer/src/attention/notify.test.ts
import { describe, it, expect } from 'vitest'
import { notifTitle } from './notify'

describe('notifTitle', () => {
  it('phrases waiting-input as a question for the user', () => {
    expect(notifTitle('waiting-input', 'claude')).toBe('claude is waiting for your reply')
  })
  it('phrases done as finished', () => {
    expect(notifTitle('done', 'tests')).toBe('tests is done')
  })
  it('phrases error as a crash', () => {
    expect(notifTitle('error', 'codex')).toBe('codex crashed')
  })
})

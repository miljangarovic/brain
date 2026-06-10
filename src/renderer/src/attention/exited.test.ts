import { describe, it, expect, beforeEach } from 'vitest'
import { markExited, consumeExited, clearExited } from './exited'

describe('exited latch', () => {
  beforeEach(() => { clearExited('t1'); clearExited('t2') })

  it('defaults to not exited', () => {
    expect(consumeExited('t1')).toBe(false)
  })
  it('consume is one-shot: true once after marking, then false', () => {
    markExited('t1')
    expect(consumeExited('t1')).toBe(true)
    expect(consumeExited('t1')).toBe(false)
    expect(consumeExited('t2')).toBe(false)
  })
  it('clearExited drops the latch without consuming', () => {
    markExited('t1')
    clearExited('t1')
    expect(consumeExited('t1')).toBe(false)
  })
})

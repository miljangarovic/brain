import { describe, it, expect, beforeEach } from 'vitest'
import { markTouched, isTouched, clearTouched } from './touched'

describe('touched registry', () => {
  beforeEach(() => { clearTouched('t1'); clearTouched('t2') })

  it('defaults to untouched', () => {
    expect(isTouched('t1')).toBe(false)
  })
  it('marks a terminal touched', () => {
    markTouched('t1')
    expect(isTouched('t1')).toBe(true)
    expect(isTouched('t2')).toBe(false)
  })
  it('marking is idempotent', () => {
    markTouched('t1')
    markTouched('t1')
    expect(isTouched('t1')).toBe(true)
  })
  it('clears a terminal', () => {
    markTouched('t1')
    clearTouched('t1')
    expect(isTouched('t1')).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { isLayoutRepaint, LAYOUT_REPAINT_MS } from './repaintGuard'

describe('isLayoutRepaint', () => {
  it('drops busy=true right after an explicit layout change (grid toggle repaint)', () => {
    expect(isLayoutRepaint(true, 1000, 900)).toBe(true)
  })
  it('lets busy=true through once the repaint window has passed', () => {
    expect(isLayoutRepaint(true, 1000 + LAYOUT_REPAINT_MS, 1000)).toBe(false)
  })
  it('never drops busy=false — it can only clear a spinner', () => {
    expect(isLayoutRepaint(false, 1000, 999)).toBe(false)
  })
  it('lets everything through when no layout change happened yet', () => {
    expect(isLayoutRepaint(true, 5000, 0)).toBe(false)
  })
})

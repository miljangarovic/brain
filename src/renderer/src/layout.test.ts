import { describe, it, expect } from 'vitest'
import { gridColumns, gridDimensions, gridLayout, paneMode, paneTerminals } from './layout'

describe('paneTerminals', () => {
  const terms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('grid mode surveys the whole feature — tab-hidden terminals included', () => {
    expect(paneTerminals(terms, ['b'], true)).toEqual(terms)
  })
  it('tabs mode shows only the visible (non-hidden) terminals', () => {
    expect(paneTerminals(terms, ['b'], false)).toEqual([{ id: 'a' }, { id: 'c' }])
  })
  it('is the identity when nothing is hidden', () => {
    expect(paneTerminals(terms, [], false)).toEqual(terms)
    expect(paneTerminals(terms, [], true)).toEqual(terms)
  })
})

describe('gridColumns', () => {
  it('uses ceil(sqrt(n)) with a floor of 1', () => {
    expect(gridColumns(0)).toBe(1)
    expect(gridColumns(1)).toBe(1)
    expect(gridColumns(2)).toBe(2)
    expect(gridColumns(3)).toBe(2)
    expect(gridColumns(4)).toBe(2)
    expect(gridColumns(5)).toBe(3)
    expect(gridColumns(9)).toBe(3)
    expect(gridColumns(10)).toBe(4)
  })
})

describe('gridDimensions', () => {
  it('returns cols and the rows needed to hold n cells', () => {
    expect(gridDimensions(1)).toEqual({ cols: 1, rows: 1 })
    expect(gridDimensions(2)).toEqual({ cols: 2, rows: 1 })
    expect(gridDimensions(3)).toEqual({ cols: 2, rows: 2 })
    expect(gridDimensions(5)).toEqual({ cols: 3, rows: 2 })
    expect(gridDimensions(9)).toEqual({ cols: 3, rows: 3 })
  })
  it('never returns zero rows', () => {
    expect(gridDimensions(0)).toEqual({ cols: 1, rows: 1 })
  })
})

describe('gridLayout', () => {
  it('keeps even counts gap-free (lastSpan 1)', () => {
    expect(gridLayout(1)).toEqual({ cols: 1, rows: 1, lastSpan: 1 })
    expect(gridLayout(2)).toEqual({ cols: 2, rows: 1, lastSpan: 1 })
    expect(gridLayout(4)).toEqual({ cols: 2, rows: 2, lastSpan: 1 })
    expect(gridLayout(6)).toEqual({ cols: 3, rows: 2, lastSpan: 1 })
  })
  it('stretches the last pane down the last column for odd counts', () => {
    // 3 -> left column stacks 2 panes, right column is one full-height pane.
    expect(gridLayout(3)).toEqual({ cols: 2, rows: 2, lastSpan: 2 })
    // 5 -> two stacked columns + a full-height rightmost pane.
    expect(gridLayout(5)).toEqual({ cols: 3, rows: 2, lastSpan: 2 })
    // 7 -> rightmost pane spans all 3 rows.
    expect(gridLayout(7)).toEqual({ cols: 3, rows: 3, lastSpan: 3 })
  })
  it('never leaves a fully-empty trailing column and the gap stays under one column', () => {
    for (let n = 1; n <= 40; n++) {
      const { cols, rows, lastSpan } = gridLayout(n)
      expect(cols * rows).toBeGreaterThanOrEqual(n)         // enough cells
      expect((cols - 1) * rows).toBeLessThan(n)             // last column is actually used
      expect(lastSpan).toBe(cols * rows - n + 1)            // span swallows exactly the gap
      expect(lastSpan).toBeLessThanOrEqual(rows)            // gap fits inside one column
    }
  })
})

describe('paneMode', () => {
  it('hides terminals outside the active group', () => {
    expect(paneMode({ inActiveGroup: false, gridMode: false })).toBe('hidden')
    expect(paneMode({ inActiveGroup: false, gridMode: true })).toBe('hidden')
  })
  it('stacks when active group is in tabs mode, grids when in grid mode', () => {
    expect(paneMode({ inActiveGroup: true, gridMode: false })).toBe('stacked')
    expect(paneMode({ inActiveGroup: true, gridMode: true })).toBe('grid')
  })
})

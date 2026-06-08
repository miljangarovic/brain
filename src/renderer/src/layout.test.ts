import { describe, it, expect } from 'vitest'
import { gridColumns, gridDimensions, paneMode } from './layout'

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

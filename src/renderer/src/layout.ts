// Pure layout helpers for the per-group grid view.
import type { GridStyle } from '@shared/types'

export function gridColumns(n: number): number {
  if (n <= 1) return 1
  return Math.ceil(Math.sqrt(n))
}

export function gridDimensions(n: number): { cols: number; rows: number } {
  const cols = gridColumns(n)
  const rows = Math.max(1, Math.ceil(n / cols))
  return { cols, rows }
}

// Grid geometry for column-major fill (`grid-auto-flow: column`): panes go
// top-to-bottom, then left-to-right. Because columns fill in order, every empty
// cell collects at the bottom of the LAST column — directly below the last pane.
// `lastSpan` is how many rows that last pane spans to swallow those leftovers, so
// an odd count leaves no gap and the rightmost pane runs the full height.
//   n=3 -> {cols:2, rows:2, lastSpan:2}   [1][3]   n=5 -> {cols:3, rows:2, lastSpan:2}
//                                          [2][3]
export function gridLayout(n: number): { cols: number; rows: number; lastSpan: number } {
  const count = Math.max(1, n)
  const { rows } = gridDimensions(count)
  // Derive columns from rows so any fully-empty trailing column is dropped — this
  // guarantees the only gaps live in (the bottom of) the last column.
  const cols = Math.max(1, Math.ceil(count / rows))
  const lastSpan = cols * rows - count + 1
  return { cols, rows, lastSpan }
}

export type PaneMode = 'hidden' | 'stacked' | 'grid'

export function paneMode(opts: { inActiveGroup: boolean; gridMode: boolean }): PaneMode {
  if (!opts.inActiveGroup) return 'hidden'
  return opts.gridMode ? 'grid' : 'stacked'
}

// gridLayout shaped by the feature's GridStyle. `flow` is the CSS
// grid-auto-flow: 'column' styles span ROWS (the big pane is a full column,
// left or right), 'row' styles transpose the geometry and span COLUMNS (the
// big pane is a full-width row, top or bottom). `spanFirst` says which pane
// gets the `lastSpan` gap-filler: the FIRST ('auto-left'/'auto-top') or the
// LAST ('auto'/'auto-bottom'). 'rows'/'cols' are plain strips, no spanning.
export function styledGridLayout(
  n: number,
  style: GridStyle
): { cols: number; rows: number; lastSpan: number; spanFirst: boolean; flow: 'column' | 'row' } {
  const count = Math.max(1, n)
  if (style === 'rows') return { cols: 1, rows: count, lastSpan: 1, spanFirst: false, flow: 'column' }
  if (style === 'cols') return { cols: count, rows: 1, lastSpan: 1, spanFirst: false, flow: 'column' }
  const base = gridLayout(count)
  if (style === 'auto-top' || style === 'auto-bottom') {
    return {
      cols: base.rows, rows: base.cols, lastSpan: base.lastSpan,
      spanFirst: style === 'auto-top' && base.lastSpan > 1,
      flow: 'row'
    }
  }
  return { ...base, spanFirst: style === 'auto-left' && base.lastSpan > 1, flow: 'column' }
}

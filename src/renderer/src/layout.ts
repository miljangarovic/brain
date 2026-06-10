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

// Which terminals the main area shows for the active feature: grid surveys the
// WHOLE feature — tab-hidden terminals included (their shells keep running and
// the grid is the feature's overview) — while tabs mode shows only the visible
// (non-hidden) set.
export function paneTerminals<T extends { id: string }>(terminals: T[], hidden: string[], gridMode: boolean): T[] {
  return gridMode ? terminals : terminals.filter((t) => !hidden.includes(t.id))
}

// gridLayout shaped by the feature's GridStyle. `spanFirst` says which pane
// gets the `lastSpan` gap-filler: the FIRST one ('auto-left' — under
// column-major flow it spans the whole first, leftmost column) or the LAST one
// ('auto' — big pane bottom-right). 'rows'/'cols' are plain strips, no spanning.
export function styledGridLayout(
  n: number,
  style: GridStyle
): { cols: number; rows: number; lastSpan: number; spanFirst: boolean } {
  const count = Math.max(1, n)
  if (style === 'rows') return { cols: 1, rows: count, lastSpan: 1, spanFirst: false }
  if (style === 'cols') return { cols: count, rows: 1, lastSpan: 1, spanFirst: false }
  const base = gridLayout(count)
  return { ...base, spanFirst: style === 'auto-left' && base.lastSpan > 1 }
}

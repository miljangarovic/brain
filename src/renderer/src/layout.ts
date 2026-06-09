// Pure layout helpers for the per-group grid view.

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

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

export type PaneMode = 'hidden' | 'stacked' | 'grid'

export function paneMode(opts: { inActiveGroup: boolean; gridMode: boolean }): PaneMode {
  if (!opts.inActiveGroup) return 'hidden'
  return opts.gridMode ? 'grid' : 'stacked'
}

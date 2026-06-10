// After an explicit layout change (grid on/off, grid style switch) every
// visible pane resizes, the PTYs get SIGWINCH, and TUI agents repaint their
// whole screen — the busy tracker reads that burst as "producing output" and
// would light the loader on terminals nobody touched. Those busy=true
// transitions are dropped in the renderer, scoped to a short window after the
// user's own action (the only moment a repaint is guaranteed not to be real
// work). busy=false always passes — it can only clear a spinner.
export const LAYOUT_REPAINT_MS = 1200

export function isLayoutRepaint(busy: boolean, nowMs: number, lastLayoutChangeMs: number): boolean {
  return busy && nowMs - lastLayoutChangeMs < LAYOUT_REPAINT_MS
}

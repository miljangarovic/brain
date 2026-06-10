// src/renderer/src/attention/decide.ts
import type { AttentionState } from './detect'

// Busy spans shorter than this are not "the agent worked and finished" — they
// are redraw blips: a resize/SIGWINCH or tab-switch repaint makes a TUI emit a
// burst of output, which flips busy on and (after the tracker's quiet window)
// off again in well under a second. A real turn keeps the spinner streaming
// for seconds. Without this gate every window resize "finishes" every visible
// background agent.
export const MIN_WORK_MS = 1500

export interface DecideCtx {
  isAgent: boolean          // terminal kind is claude/codex
  underReview: boolean      // reviewer terminal, or an origin under an active review
  activeAndFocused: boolean // user is currently looking at this terminal
}

export interface IdleCtx extends DecideCtx {
  armed: boolean            // user typed in this terminal since the last alert
  workSpanMs: number        // how long the busy phase that just ended lasted
}

// Common gate: only agents, never review-owned terminals, never while you watch it.
function suppressed(ctx: DecideCtx): boolean {
  return !ctx.isAgent || ctx.underReview || ctx.activeAndFocused
}

// busy→idle: the classified state to set, or null to do nothing. Idle-derived
// signals additionally require (a) the terminal to be armed — the user typed in
// it since the last alert, so there is a turn of theirs to finish — and (b) a
// busy span long enough to be actual work rather than a repaint.
export function decideOnIdle(state: 'waiting-input' | 'done', ctx: IdleCtx): AttentionState | null {
  if (suppressed(ctx) || !ctx.armed || ctx.workSpanMs < MIN_WORK_MS) return null
  return state
}

// pty exit: 'error' for a non-zero code, else null (clean exit is intentional).
// Not gated on armed/span — a crash is worth knowing about even for a terminal
// you never touched.
export function decideOnExit(code: number, ctx: DecideCtx): AttentionState | null {
  if (suppressed(ctx) || code === 0) return null
  return 'error'
}

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

// How long the agent actually produced output: busy=false is emitted only after
// `idleMs` of silence, so the trailing quiet window must be subtracted — without
// this every sub-second redraw blip "lasts" at least idleMs and defeats the
// MIN_WORK_MS gate (the source of fake "je gotov" notifications).
export function outputSpanMs(busyStartedAt: number | undefined, idleEmittedAt: number, idleMs: number): number {
  if (busyStartedAt === undefined) return 0
  return Math.max(0, idleEmittedAt - busyStartedAt - idleMs)
}

// busy→idle: the classified state to set, or null to do nothing. Idle-derived
// signals require the terminal to be armed — the user engaged it since the last
// alert, so there is a turn of theirs to finish. 'done' additionally needs a
// busy span long enough to be actual work rather than a repaint; a permission
// prompt ('waiting-input') alerts regardless of span — claude often asks before
// doing any work at all, and the agent is blocked either way.
export function decideOnIdle(state: 'waiting-input' | 'done', ctx: IdleCtx): AttentionState | null {
  if (suppressed(ctx) || !ctx.armed) return null
  if (state === 'done' && ctx.workSpanMs < MIN_WORK_MS) return null
  return state
}

// pty exit: 'error' for a non-zero code, else null (clean exit is intentional).
// Not gated on armed/span — a crash is worth knowing about even for a terminal
// you never touched.
export function decideOnExit(code: number, ctx: DecideCtx): AttentionState | null {
  if (suppressed(ctx) || code === 0) return null
  return 'error'
}

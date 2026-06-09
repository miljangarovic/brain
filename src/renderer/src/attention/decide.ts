// src/renderer/src/attention/decide.ts
import type { AttentionState } from './detect'

export interface DecideCtx {
  isAgent: boolean          // terminal kind is claude/codex
  underReview: boolean      // reviewer terminal, or an origin under an active review
  activeAndFocused: boolean // user is currently looking at this terminal
}

// Common gate: only agents, never review-owned terminals, never while you watch it.
function suppressed(ctx: DecideCtx): boolean {
  return !ctx.isAgent || ctx.underReview || ctx.activeAndFocused
}

// busy→idle: the classified state to set, or null to do nothing.
export function decideOnIdle(state: 'waiting-input' | 'done', ctx: DecideCtx): AttentionState | null {
  return suppressed(ctx) ? null : state
}

// pty exit: 'error' for a non-zero code, else null (clean exit is intentional).
export function decideOnExit(code: number, ctx: DecideCtx): AttentionState | null {
  if (suppressed(ctx) || code === 0) return null
  return 'error'
}

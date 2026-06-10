// src/renderer/src/attention/detect.ts
export type AttentionState = 'waiting-input' | 'done' | 'error'

// Strip ANSI escape sequences so prompt matching works on clean text. (xterm's
// buffer is already mostly de-escaped, but a stray sequence shouldn't break a match.)
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC ... BEL or ST
    .replace(/\x1B[@-Z\\-_]/g, '')                     // single-char escapes
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')         // CSI sequences
}

// Patterns that mark "the agent stopped on a question and is blocked on you".
// Small and easily extended; case-insensitive. A miss falls back to 'done', so a
// wrong pattern only mislabels — the user still gets an "agent needs you" signal.
export const PERMISSION_PATTERNS: RegExp[] = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\bdo you want\b/i,
  /\bwould you like\b/i,
  /\bapprove\b/i,
  /\ballow\b/i,
  /\bproceed\?/i,
  /\bpress enter\b/i,
  /\bcontinue\?/i,
  /❯\s*\d+\./, // numbered choice prompt (claude/codex menus)
]

// Classify a terminal that just went idle from its recent output tail.
export function classifyIdle(tail: string): 'waiting-input' | 'done' {
  const clean = stripAnsi(tail)
  return PERMISSION_PATTERNS.some((re) => re.test(clean)) ? 'waiting-input' : 'done'
}

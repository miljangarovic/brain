// Delay between writing a prompt into an agent terminal and sending the Enter
// that submits it. Agent TUIs (claude/codex) coalesce a single chunk ending in
// CR into a multi-line paste — the trailing Enter becomes a literal newline in
// the input instead of submitting. Sending the CR as a separate keystroke a tick
// later lands it as a real "submit", the same way a human pastes then presses Enter.
export const SUBMIT_DELAY_MS = 100

// Write `text` into the PTY, then submit it with a lone CR after SUBMIT_DELAY_MS.
export function submitToPty(id: string, text: string): void {
  window.orchestrix.writePty(id, text)
  setTimeout(() => window.orchestrix.writePty(id, '\r'), SUBMIT_DELAY_MS)
}

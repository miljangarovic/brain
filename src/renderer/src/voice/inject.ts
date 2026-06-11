// Bracketed-paste envelope for injecting a prompt into a live agent's PTY:
// multiline text must not let embedded newlines submit early. Submission
// itself goes through review/submit.ts's submitToPty — text first, lone CR
// after its calibrated SUBMIT_DELAY_MS (do NOT reintroduce a second delay
// constant for the same paste-then-Enter race).
export function envelopePrompt(prompt: string): string {
  return prompt.includes('\n') ? `\x1b[200~${prompt}\x1b[201~` : prompt
}

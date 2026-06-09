import type { ReviewPhase } from '@shared/types'

/** POSIX single-quote escaping for embedding a prompt as one shell argument. */
export function shellSingleQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

/** `<agent> '<prompt>'` — launches the agent with the prompt as its first message. */
export function buildReviewerCommand(agentCommand: string, prompt: string): string {
  return `${agentCommand} ${shellSingleQuote(prompt)}`
}

export interface ReviewerPromptArgs {
  phase: ReviewPhase
  round: number
  reviewFile: string
  transcriptPath?: string
  intentPath?: string
  specPath?: string
  intent?: string
}

const VERDICT_CONTRACT =
  'On the FIRST line of the file write EXACTLY one of: `VERDICT: APPROVED` or `VERDICT: NEEDS-WORK` ' +
  '— use APPROVED only when you have no blocking concerns — then write the critique below.'

function bodyLines(a: ReviewerPromptArgs): string[] {
  const intent = a.intent?.trim()
  if (a.phase === 'intent') {
    return [
      'You are a reviewer — a second AI agent. Do NOT modify any files; only WRITE your critique to the review file.',
      `Read the author's conversation transcript (JSONL, one message per line) at: ${a.transcriptPath ?? '(transcript unavailable — judge from the intent note below)'}.`,
      intent ? `The author summarized the goal as: ${intent}.` : "Infer the author's goal from the transcript.",
      'Judge whether the INTENT is clear and complete: problem, goals, constraints, success criteria. Flag gaps, ambiguities, and contradictions.'
    ]
  }
  if (a.phase === 'spec') {
    return [
      'You are a reviewer — a second AI agent. Do NOT modify the spec; only WRITE your critique to the review file.',
      `Review the spec/plan at: ${a.specPath ?? '(spec not yet written)'}. The agreed intent is at: ${a.intentPath ?? '(intent not yet written)'}.`,
      'Judge: does the spec fully cover the intent? Correctness, gaps, contradictions, scope (YAGNI), feasibility. Be concrete; propose exact changes.'
    ]
  }
  return [
    'You are a reviewer — a second AI agent. Do NOT commit; only WRITE your critique to the review file.',
    'Run `git status` and `git diff` and review the uncommitted changes in this repository.',
    `The intent is at: ${a.intentPath ?? '(intent not yet written)'}; the spec is at: ${a.specPath ?? '(spec not yet written)'}.`,
    'Judge: does the implementation follow the spec? Bugs, edge cases, correctness, simplicity.'
  ]
}

export function reviewerPromptLines(a: ReviewerPromptArgs): string[] {
  const preamble = a.round > 1
    ? ['The author has revised in response to your previous critique — re-review from scratch.']
    : []
  return [...preamble, ...bodyLines(a), VERDICT_CONTRACT, `WRITE your critique to (create or overwrite): ${a.reviewFile}.`]
}

/** Multi-line form — used as the reviewer terminal's startupCommand (first spawn). */
export const reviewerStartupPrompt = (a: ReviewerPromptArgs): string => reviewerPromptLines(a).join('\n')

/** Single-line form — written into the existing reviewer PTY for later rounds/phases
 *  (newlines would submit prematurely in an agent TUI). */
export const reviewerInjectPrompt = (a: ReviewerPromptArgs): string => reviewerPromptLines(a).join(' ')

export interface RelayPromptArgs {
  phase: ReviewPhase
  reviewFile: string
  intentPath?: string
  specPath?: string
}

/** Single-line prompt injected into the origin (A) telling it to apply the critique. */
export function relayToOriginPrompt(a: RelayPromptArgs): string {
  if (a.phase === 'intent') {
    return `The reviewer left a critique in ${a.reviewFile}. Update the intent document ${a.intentPath ?? '(the intent document)'} (create it if missing) where you agree; where you disagree, briefly explain why. Do not start the spec or code yet.`
  }
  if (a.phase === 'spec') {
    return `The reviewer left a critique in ${a.reviewFile}. Update ${a.specPath ?? '(the spec)'} where you agree; where you disagree, briefly explain. Do not implement yet.`
  }
  return `The reviewer left a critique in ${a.reviewFile}. Apply the fixes in the code where you agree; where you disagree, briefly explain. Do not commit.`
}

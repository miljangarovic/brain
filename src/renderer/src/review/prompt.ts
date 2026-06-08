import type { ReviewKind } from '@shared/types'

/** POSIX single-quote escaping for embedding a prompt as one shell argument. */
export function shellSingleQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

/** `<agent> '<prompt>'` — launches the agent with the prompt as its first message. */
export function buildReviewerCommand(agentCommand: string, prompt: string): string {
  return `${agentCommand} ${shellSingleQuote(prompt)}`
}

export interface ReviewerPromptArgs {
  kind: ReviewKind
  reviewFile: string
  specPath?: string
  intent?: string
}

export function reviewerPrompt(a: ReviewerPromptArgs): string {
  const intent = a.intent?.trim()
  if (a.kind === 'spec') {
    return [
      'You are a reviewer — a second AI agent. Do NOT modify the spec; only WRITE your critique to a file.',
      `Review the spec/plan at: ${a.specPath}.`,
      `Author's goal: ${intent || '(infer it from the document itself)'}.`,
      'Critique rigorously: correctness, gaps and ambiguities, contradictions, scope (YAGNI), feasibility.',
      'Be concrete; propose exact changes.',
      `WRITE your critique to the file (create or overwrite): ${a.reviewFile}.`
    ].join('\n')
  }
  return [
    'You are a reviewer — a second AI agent. Do NOT commit; only WRITE your critique to a file.',
    'Run `git status` and `git diff` and review the uncommitted changes in this repository.',
    `Task goal: ${intent || '(infer it from the changes themselves)'}.`,
    'Critique rigorously: bugs, edge cases, correctness, clarity, simplicity.',
    `WRITE your critique to the file (create or overwrite): ${a.reviewFile}.`
  ].join('\n')
}

export interface RelayPromptArgs {
  kind: ReviewKind
  reviewFile: string
  specPath?: string
}

export function relayToOriginPrompt(a: RelayPromptArgs): string {
  if (a.kind === 'spec') {
    return `The reviewer left a critique in ${a.reviewFile}. Read it and update ${a.specPath} where you agree; where you disagree, briefly explain why.`
  }
  return `The reviewer left a critique in ${a.reviewFile}. Read it and apply the fixes in the code where you agree; where you disagree, briefly explain. Do not commit.`
}

export interface ReReviewPromptArgs {
  kind: ReviewKind
  reviewFile: string
  specPath?: string
}

export function reReviewPrompt(a: ReReviewPromptArgs): string {
  if (a.kind === 'spec') {
    return `The spec was updated. Review ${a.specPath} again and write a new critique to ${a.reviewFile}.`
  }
  return `The changes were updated. Re-run git diff, review, and write a new critique to ${a.reviewFile}.`
}

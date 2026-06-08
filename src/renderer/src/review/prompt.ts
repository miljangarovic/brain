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
      'Ti si reviewer — drugi AI agent. NE mijenjaj spec; samo napiši kritiku u fajl.',
      `Pregledaj spec/plan u: ${a.specPath}.`,
      `Cilj autora: ${intent || '(izvedi iz samog dokumenta)'}.`,
      'Oceni kritički: ispravnost, rupe i nedorečenosti, kontradikcije, scope (YAGNI), izvodljivost.',
      'Budi konkretan; predloži tačne izmjene.',
      `Svoju kritiku UPIŠI u fajl (kreiraj ili prepiši): ${a.reviewFile}.`
    ].join('\n')
  }
  return [
    'Ti si reviewer — drugi AI agent. NE commituj; samo napiši kritiku u fajl.',
    'Pokreni `git status` i `git diff` i pregledaj necommitovane izmjene u ovom repozitorijumu.',
    `Cilj zadatka: ${intent || '(izvedi iz samih izmjena)'}.`,
    'Oceni kritički: bugove, edge-case-ove, ispravnost, jasnoću, jednostavnost.',
    `Svoju kritiku UPIŠI u fajl (kreiraj ili prepiši): ${a.reviewFile}.`
  ].join('\n')
}

export interface RelayPromptArgs {
  kind: ReviewKind
  reviewFile: string
  specPath?: string
}

export function relayToOriginPrompt(a: RelayPromptArgs): string {
  if (a.kind === 'spec') {
    return `Reviewer je ostavio kritiku u ${a.reviewFile}. Pročitaj je i ažuriraj ${a.specPath} gdje se slažeš; gdje se ne slažeš, kratko objasni zašto.`
  }
  return `Reviewer je ostavio kritiku u ${a.reviewFile}. Pročitaj je i primijeni ispravke u kodu gdje se slažeš; gdje se ne slažeš, kratko objasni. Ne commituj.`
}

export interface ReReviewPromptArgs {
  kind: ReviewKind
  reviewFile: string
  specPath?: string
}

export function reReviewPrompt(a: ReReviewPromptArgs): string {
  if (a.kind === 'spec') {
    return `Spec je ažuriran. Ponovo pregledaj ${a.specPath} i upiši novu kritiku u ${a.reviewFile}.`
  }
  return `Izmjene su ažurirane. Ponovo pokreni git diff, pregledaj i upiši novu kritiku u ${a.reviewFile}.`
}

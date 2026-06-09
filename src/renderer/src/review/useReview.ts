import { useRef, useCallback } from 'react'
import type { AppState } from '../store'
import { addTerminal, removeTerminal, patchReviewLink, findReviewerFor, featureIdOfTerminal, getTerminalById } from '../store'
import type { ReviewPhase, ReviewStatus, ReviewLink } from '@shared/types'
import { createId } from '@shared/id'
import { AGENTS, type AgentKind } from '../agents'
import { buildReviewerCommand, reviewerStartupPrompt, reviewerInjectPrompt, relayToOriginPrompt } from './prompt'
import { parseVerdict } from './verdict'
import { afterApply } from './phases'
import { submitToPty } from './submit'

export interface StartReviewArgs {
  originTerminalId: string
  reviewer: AgentKind
  phase: ReviewPhase
  maxRounds: number
  specPath?: string
  intent?: string
}

export function useReview(
  state: AppState,
  apply: (fn: (s: AppState) => AppState) => void,
  setStatus: (id: string, status: ReviewStatus | undefined) => void
) {
  // watchId → the reviewer + file we're waiting on (its critique write).
  const watching = useRef(new Map<string, { reviewerId: string; reviewFile: string }>())
  // originId → arming phase for the "origin finished applying" busy→idle signal.
  const awaiting = useRef(new Map<string, 'pending' | 'working'>())

  const armReviewWatch = useCallback((reviewerId: string, reviewFile: string, phase: ReviewPhase, round: number) => {
    const watchId = `review:${reviewerId}:${phase}:${round}`
    watching.current.set(watchId, { reviewerId, reviewFile })
    window.orchestrix.watchFile(watchId, reviewFile)
  }, [])

  // Send a review request for (phase, round) into the existing reviewer PTY and
  // re-arm the watch. Shared by every round/phase after the initial spawn.
  const requestReview = useCallback((link: ReviewLink, reviewerId: string, phase: ReviewPhase, round: number, reviewFile: string) => {
    const prompt = reviewerInjectPrompt({
      phase, round, reviewFile,
      transcriptPath: link.transcriptPath, intentPath: link.intentPath, specPath: link.specPath
    })
    submitToPty(reviewerId, prompt)
    setStatus(reviewerId, 'reviewing')
    setStatus(link.originTerminalId, 'under-review')
    armReviewWatch(reviewerId, reviewFile, phase, round)
  }, [setStatus, armReviewWatch])

  // A phase passed review: remove the (now finished) reviewer terminal — App's PTY
  // reaper kills its PTY — clean up its watches/arming, and mark the origin green
  // ('approved'), which holds until the origin's next request.
  const finalizeApproved = useCallback((reviewerId: string, originId: string) => {
    awaiting.current.delete(originId)
    for (const [watchId, w] of [...watching.current]) {
      if (w.reviewerId === reviewerId) { window.orchestrix.unwatchFile(watchId); watching.current.delete(watchId) }
    }
    apply((s) => removeTerminal(s, reviewerId))
    setStatus(reviewerId, undefined)
    setStatus(originId, 'approved')
  }, [apply, setStatus])

  // 1. Start a brand-new review: spawn the reviewer terminal bound to the origin.
  const startReview = useCallback(async (a: StartReviewArgs) => {
    const featureId = featureIdOfTerminal(state, a.originTerminalId)
    if (!featureId) return
    const origin = getTerminalById(state, a.originTerminalId)
    const round = 1
    const paths = await window.orchestrix.resolveReviewDir(a.originTerminalId, a.phase, round)
    const transcriptPath = await window.orchestrix.resolveTranscript(origin?.cwd ?? '', origin?.kind)
    const link: ReviewLink = {
      originTerminalId: a.originTerminalId,
      phase: a.phase, round, maxRounds: a.maxRounds,
      reviewDir: paths.reviewDir,
      transcriptPath: transcriptPath ?? undefined,
      intentPath: paths.intentPath,
      specPath: a.specPath?.trim() || paths.specPath
    }
    const startup = reviewerStartupPrompt({
      phase: a.phase, round, reviewFile: paths.reviewFile,
      transcriptPath: link.transcriptPath, intentPath: link.intentPath, specPath: link.specPath, intent: a.intent
    })
    const reviewerId = createId()
    apply((s) => addTerminal(s, featureId, {
      id: reviewerId, name: `review: ${a.reviewer}`, kind: a.reviewer,
      startupCommand: buildReviewerCommand(AGENTS[a.reviewer].command, startup), review: link
    }))
    setStatus(reviewerId, 'reviewing')
    setStatus(a.originTerminalId, 'under-review')
    armReviewWatch(reviewerId, paths.reviewFile, a.phase, round)
  }, [state, apply, setStatus, armReviewWatch])

  // 2. Reviewer wrote its critique → read it, parse the verdict, branch.
  const handleFsChanged = useCallback(async (watchId: string) => {
    const w = watching.current.get(watchId)
    if (!w) return
    watching.current.delete(watchId)
    window.orchestrix.unwatchFile(watchId)
    const reviewer = getTerminalById(state, w.reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const text = (await window.orchestrix.readTextFile(w.reviewFile)) ?? ''
    if (parseVerdict(text) === 'approved') {
      finalizeApproved(reviewer.id, link.originTerminalId) // reviewer closes; origin goes green
      return
    }
    // NEEDS-WORK → auto-relay to the origin and wait for it to finish applying.
    const relay = relayToOriginPrompt({ phase: link.phase, reviewFile: w.reviewFile, intentPath: link.intentPath, specPath: link.specPath })
    submitToPty(link.originTerminalId, relay)
    setStatus(reviewer.id, undefined)
    setStatus(link.originTerminalId, 'applying')
    awaiting.current.set(link.originTerminalId, 'pending')
  }, [state, setStatus, finalizeApproved])

  // 3. Origin busy→idle while applying → next round (or stop at the cap).
  const handleBusy = useCallback(async (id: string, busy: boolean) => {
    const arm = awaiting.current.get(id)
    if (!arm) return
    if (busy) { awaiting.current.set(id, 'working'); return }  // origin started producing output
    if (arm !== 'working') return                             // ignore idle before any work began
    awaiting.current.delete(id)
    const reviewer = findReviewerFor(state, id)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const decision = afterApply(link.round, link.maxRounds)
    if (decision.type === 'stop') {
      setStatus(reviewer.id, 'needs-decision')
      setStatus(id, undefined)
      return
    }
    const paths = await window.orchestrix.resolveReviewDir(id, link.phase, decision.round)
    apply((s) => patchReviewLink(s, reviewer.id, { round: decision.round }))
    requestReview(link, reviewer.id, link.phase, decision.round, paths.reviewFile)
  }, [state, apply, setStatus, requestReview])

  // 4a. needs-decision: raise the cap and run more rounds.
  const moreRounds = useCallback(async (reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const round = link.round + 1
    const maxRounds = link.maxRounds + 3
    const paths = await window.orchestrix.resolveReviewDir(link.originTerminalId, link.phase, round)
    apply((s) => patchReviewLink(s, reviewer.id, { round, maxRounds }))
    requestReview({ ...link, maxRounds }, reviewer.id, link.phase, round, paths.reviewFile)
  }, [state, apply, requestReview])

  // 4b. needs-decision: accept the current state as approved (reviewer closes, origin green).
  const acceptPhase = useCallback((reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    if (!reviewer?.review) return
    finalizeApproved(reviewer.id, reviewer.review.originTerminalId)
  }, [state, finalizeApproved])

  // 5. Stop the loop entirely (manual escape): remove the reviewer, clear the origin (no green).
  const stopLoop = useCallback((reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    awaiting.current.delete(link.originTerminalId)
    for (const [watchId, w] of [...watching.current]) {
      if (w.reviewerId === reviewer.id) { window.orchestrix.unwatchFile(watchId); watching.current.delete(watchId) }
    }
    apply((s) => removeTerminal(s, reviewer.id))
    setStatus(reviewer.id, undefined)
    setStatus(link.originTerminalId, undefined)
  }, [state, apply, setStatus])

  return { startReview, handleFsChanged, handleBusy, moreRounds, acceptPhase, stopLoop }
}

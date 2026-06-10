import { useEffect, useRef, useCallback } from 'react'
import type { AppState } from '../store'
import { addTerminal, removeTerminal, patchReviewLink, findReviewerFor, featureIdOfTerminal, getTerminalById, allTerminals } from '../store'
import type { ReviewPhase, ReviewStatus, ReviewLink } from '@shared/types'
import { createId } from '@shared/id'
import { AGENTS, type AgentKind } from '../agents'
import { readTail } from '../attention/tailRegistry'
import { classifyIdle } from '../attention/detect'
import { buildReviewerCommand, reviewerStartupPrompt, reviewerInjectPrompt, relayToOriginPrompt } from './prompt'
import { parseVerdictStrict } from './verdict'
import { afterApply, reviewFileFor } from './phases'
import { submitToPty } from './submit'

const watchIdFor = (reviewerId: string, phase: ReviewPhase, round: number) => `review:${reviewerId}:${phase}:${round}`

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
  setStatus: (id: string, status: ReviewStatus | undefined) => void,
  reviewStatus: Record<string, ReviewStatus | undefined>
) {
  // watchId → the reviewer + file we're waiting on (its critique write).
  const watching = useRef(new Map<string, { reviewerId: string; reviewFile: string }>())
  // originId → arming phase for the "origin finished applying" busy→idle signal.
  const awaiting = useRef(new Map<string, 'pending' | 'working'>())
  // Current statuses, readable from the reconcile effect without re-running it.
  const statusRef = useRef(reviewStatus)
  statusRef.current = reviewStatus

  const armReviewWatch = useCallback((reviewerId: string, reviewFile: string, phase: ReviewPhase, round: number) => {
    const watchId = watchIdFor(reviewerId, phase, round)
    watching.current.set(watchId, { reviewerId, reviewFile })
    window.brain.watchFile(watchId, reviewFile)
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
      if (w.reviewerId === reviewerId) { window.brain.unwatchFile(watchId); watching.current.delete(watchId) }
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
    const paths = await window.brain.resolveReviewDir(a.originTerminalId, a.phase, round)
    const transcriptPath = await window.brain.resolveTranscript(origin?.cwd ?? '', origin?.kind)
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

  // 2. Reviewer wrote to its critique file → read it; act only on a valid verdict.
  const handleFsChanged = useCallback(async (watchId: string) => {
    const w = watching.current.get(watchId)
    if (!w) return
    const reviewer = getTerminalById(state, w.reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) {
      // Reviewer vanished (deleted along with its feature/group) — release the watch.
      watching.current.delete(watchId)
      window.brain.unwatchFile(watchId)
      return
    }
    const text = (await window.brain.readTextFile(w.reviewFile)) ?? ''
    const verdict = parseVerdictStrict(text)
    // No VERDICT line yet — the reviewer is still writing (empty create, partial
    // flush). Keep the watch armed: acting now would misread APPROVED as
    // needs-work and tear the watch down before the real verdict ever lands.
    if (!verdict) return
    watching.current.delete(watchId)
    window.brain.unwatchFile(watchId)
    if (verdict === 'approved') {
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
    // The busy tracker calls 1.5s of output silence "idle", but an origin stopped
    // on a permission prompt is silent too — re-reviewing now would burn a round
    // against unchanged work. Hold: answering the prompt makes the origin busy
    // again, and its next real idle advances the loop.
    if (classifyIdle(readTail(id)) === 'waiting-input') return
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
    const paths = await window.brain.resolveReviewDir(id, link.phase, decision.round)
    apply((s) => patchReviewLink(s, reviewer.id, { round: decision.round }))
    requestReview(link, reviewer.id, link.phase, decision.round, paths.reviewFile)
  }, [state, apply, setStatus, requestReview])

  // Reconcile watches with the workspace. The loop's coordination state
  // (`watching`/`awaiting`/statuses) lives only in this renderer and dies with it
  // (reload, crash, app restart), while the review link and the verdict file
  // survive — without re-arming, a restored review never delivers its verdict:
  // the fs event finds an empty watching map and is silently dropped, and
  // isUnderReview keeps suppressing attention for both terminals forever.
  useEffect(() => {
    // Reap watches whose reviewer left the workspace (deleting a feature/group
    // bypasses stopLoop) so main's fs.watch handle is released.
    for (const [watchId, w] of [...watching.current]) {
      if (!getTerminalById(state, w.reviewerId)) {
        watching.current.delete(watchId)
        window.brain.unwatchFile(watchId)
      }
    }
    for (const t of allTerminals(state)) {
      const link = t.review
      if (!link) continue
      if (statusRef.current[t.id] !== undefined) continue        // loop already alive in this renderer
      if (awaiting.current.has(link.originTerminalId)) continue  // origin applying — deliberately unwatched
      const watchId = watchIdFor(t.id, link.phase, link.round)
      if (watching.current.has(watchId)) continue
      armReviewWatch(t.id, reviewFileFor(link), link.phase, link.round)
      setStatus(t.id, 'reviewing')
      setStatus(link.originTerminalId, 'under-review')
      // The verdict may already be on disk (written while we were away) and
      // fs.watch alone would never fire for it — check once. A NEEDS-WORK that
      // was already relayed before the reload relays a second time; the loop
      // converges, which beats stalling forever.
      void handleFsChanged(watchId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconcile when the terminal tree changes
  }, [state.workspace])

  // 4a. needs-decision: raise the cap and run more rounds.
  const moreRounds = useCallback(async (reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const round = link.round + 1
    const maxRounds = link.maxRounds + 3
    const paths = await window.brain.resolveReviewDir(link.originTerminalId, link.phase, round)
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
      if (w.reviewerId === reviewer.id) { window.brain.unwatchFile(watchId); watching.current.delete(watchId) }
    }
    apply((s) => removeTerminal(s, reviewer.id))
    setStatus(reviewer.id, undefined)
    setStatus(link.originTerminalId, undefined)
  }, [state, apply, setStatus])

  return { startReview, handleFsChanged, handleBusy, moreRounds, acceptPhase, stopLoop }
}

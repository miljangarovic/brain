import { useEffect, useRef, useCallback } from 'react'
import type { AppState } from '../store'
import { addTerminal, removeTerminal, patchReviewLink, findReviewersFor, featureIdOfTerminal, getTerminalById, allTerminals, setTerminalSessionId } from '../store'
import type { ReviewPhase, ReviewStatus, ReviewLink } from '@shared/types'
import { createId } from '@shared/id'
import { agentLaunchCommand, type AgentKind } from '../agents'
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

// One origin's in-flight apply cycle: critiques already relayed this cycle
// (their reviewers advance together when the origin settles) and critiques
// queued behind the one being applied — two at once would interleave.
interface ApplyCycle {
  arm: 'pending' | 'working'
  applied: string[]                               // reviewerIds relayed this cycle
  queue: { reviewerId: string; relay: string }[]  // critiques waiting their turn
}

export function useReview(
  state: AppState,
  apply: (fn: (s: AppState) => AppState) => void,
  setStatus: (id: string, status: ReviewStatus | undefined) => void,
  reviewStatus: Record<string, ReviewStatus | undefined>
) {
  // watchId → the reviewer + file we're waiting on (its critique write).
  const watching = useRef(new Map<string, { reviewerId: string; reviewFile: string }>())
  // originId → in-flight apply cycle for the "origin finished applying" signal.
  const awaiting = useRef(new Map<string, ApplyCycle>())
  // Current statuses, readable from the reconcile effect without re-running it.
  const statusRef = useRef(reviewStatus)
  statusRef.current = reviewStatus
  // Reviewers finalized/stopped this tick — `state` lags one render behind
  // apply(), so a second verdict in the same tick would still "see" the first
  // reviewer and miss the last-one-out transition. Terminal ids are UUIDs and
  // never recycled, so the set needs no cleanup.
  const removed = useRef(new Set<string>())

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
    // Don't stomp 'applying': a late NEEDS-WORK can open a new apply cycle on
    // the origin while advance-all is still awaiting path resolution.
    if (!awaiting.current.has(link.originTerminalId)) setStatus(link.originTerminalId, 'under-review')
    armReviewWatch(reviewerId, reviewFile, phase, round)
  }, [setStatus, armReviewWatch])

  // A reviewer approved: remove its terminal — App's PTY reaper kills its PTY —
  // and clean up its watches and any queued critique. The origin goes green
  // only when the LAST reviewer leaves: ALL must approve (intent decision).
  const finalizeApproved = useCallback((reviewerId: string, originId: string) => {
    for (const [watchId, w] of [...watching.current]) {
      if (w.reviewerId === reviewerId) { window.brain.unwatchFile(watchId); watching.current.delete(watchId) }
    }
    const cycle = awaiting.current.get(originId)
    if (cycle) {
      cycle.applied = cycle.applied.filter((rid) => rid !== reviewerId)
      cycle.queue = cycle.queue.filter((q) => q.reviewerId !== reviewerId)
    }
    apply((s) => removeTerminal(s, reviewerId))
    setStatus(reviewerId, undefined)
    removed.current.add(reviewerId)
    const others = findReviewersFor(state, originId)
      .filter((r) => r.id !== reviewerId && !removed.current.has(r.id))
    if (others.length === 0) {
      awaiting.current.delete(originId)
      setStatus(originId, 'approved')
    }
  }, [state, apply, setStatus])

  // 1. Start a brand-new review: spawn the reviewer terminal bound to the origin.
  const startReview = useCallback(async (a: StartReviewArgs) => {
    const featureId = featureIdOfTerminal(state, a.originTerminalId)
    if (!featureId) return
    const origin = getTerminalById(state, a.originTerminalId)
    const round = 1
    const paths = await window.brain.resolveReviewDir(a.originTerminalId, a.reviewer, a.phase, round)
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
    // Pin the reviewer's own conversation id, exactly like launchAgent does for
    // ordinary agent terminals — a restored reviewer must resume ITS session,
    // not fall back to "most recent in cwd" (which is usually the origin's).
    const reviewerSessionId = a.reviewer === 'claude' ? createId() : undefined
    apply((s) => addTerminal(s, featureId, {
      id: reviewerId, name: `${a.reviewer} review: ${origin?.name ?? a.reviewer}`, kind: a.reviewer,
      startupCommand: buildReviewerCommand(agentLaunchCommand(a.reviewer, reviewerSessionId), startup),
      review: link, sessionId: reviewerSessionId
    }))
    if (a.reviewer === 'codex') {
      // codex can't pin an id at launch — detect it from the rollout it writes,
      // excluding ids already owned by other terminals (same as launchAgent).
      const exclude = allTerminals(state).map((t) => t.sessionId).filter((s): s is string => !!s)
      void window.brain.captureAgentSession({ kind: 'codex', cwd: origin?.cwd ?? '', exclude }).then((sid) => {
        if (sid) apply((s) => setTerminalSessionId(s, reviewerId, sid))
      })
    }
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
    // NEEDS-WORK → relay to the origin; if the origin is already applying
    // another reviewer's critique, queue this one for the next idle.
    const relay = relayToOriginPrompt({ phase: link.phase, reviewFile: w.reviewFile, intentPath: link.intentPath, specPath: link.specPath })
    setStatus(reviewer.id, undefined)
    const cycle = awaiting.current.get(link.originTerminalId)
    if (cycle) { cycle.queue.push({ reviewerId: reviewer.id, relay }); return }
    submitToPty(link.originTerminalId, relay)
    setStatus(link.originTerminalId, 'applying')
    awaiting.current.set(link.originTerminalId, { arm: 'pending', applied: [reviewer.id], queue: [] })
  }, [state, setStatus, finalizeApproved])

  // 3. Origin busy→idle while applying → relay the next queued critique, or —
  // when the queue is dry — advance EVERY reviewer applied this cycle.
  const handleBusy = useCallback(async (id: string, busy: boolean) => {
    const cycle = awaiting.current.get(id)
    if (!cycle) return
    if (busy) { cycle.arm = 'working'; return }       // origin started producing output
    if (cycle.arm !== 'working') return               // ignore idle before any work began
    // The busy tracker calls 1.5s of output silence "idle", but an origin stopped
    // on a permission prompt is silent too — re-reviewing now would burn a round
    // against unchanged work. Hold: answering the prompt makes the origin busy
    // again, and its next real idle advances the loop.
    if (classifyIdle(readTail(id)) === 'waiting-input') return
    const next = cycle.queue.shift()
    if (next) {
      cycle.applied.push(next.reviewerId)
      cycle.arm = 'pending'
      submitToPty(id, next.relay)
      return
    }
    awaiting.current.delete(id)
    let anyIterating = false
    for (const reviewerId of cycle.applied) {
      const reviewer = getTerminalById(state, reviewerId)
      const link = reviewer?.review
      if (!reviewer || !link) continue
      const decision = afterApply(link.round, link.maxRounds)
      if (decision.type === 'stop') { setStatus(reviewer.id, 'needs-decision'); continue }
      anyIterating = true
      const kind: AgentKind = reviewer.kind === 'codex' ? 'codex' : 'claude'
      const paths = await window.brain.resolveReviewDir(id, kind, link.phase, decision.round)
      apply((s) => patchReviewLink(s, reviewer.id, { round: decision.round, reviewDir: paths.reviewDir }))
      requestReview(link, reviewer.id, link.phase, decision.round, paths.reviewFile)
    }
    // A reviewer whose verdict hasn't landed yet is NOT in this cycle — its
    // armed watch marks it still reviewing, so the origin keeps its badge.
    if (!anyIterating) {
      const stillReviewing = findReviewersFor(state, id).some((r) =>
        [...watching.current.values()].some((w) => w.reviewerId === r.id))
      setStatus(id, stillReviewing ? 'under-review' : undefined)
    }
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
    const kind: AgentKind = reviewer.kind === 'codex' ? 'codex' : 'claude'
    const paths = await window.brain.resolveReviewDir(link.originTerminalId, kind, link.phase, round)
    apply((s) => patchReviewLink(s, reviewer.id, { round, maxRounds, reviewDir: paths.reviewDir }))
    requestReview({ ...link, maxRounds }, reviewer.id, link.phase, round, paths.reviewFile)
  }, [state, apply, requestReview])

  // 4b. needs-decision: accept the current state as approved (reviewer closes, origin green).
  const acceptPhase = useCallback((reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    if (!reviewer?.review) return
    finalizeApproved(reviewer.id, reviewer.review.originTerminalId)
  }, [state, finalizeApproved])

  // 5. Stop ONE reviewer's loop (manual escape): remove it; clear the origin
  // (no green) only when it was the last reviewer.
  const stopLoop = useCallback((reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    for (const [watchId, w] of [...watching.current]) {
      if (w.reviewerId === reviewer.id) { window.brain.unwatchFile(watchId); watching.current.delete(watchId) }
    }
    const originId = link.originTerminalId
    const cycle = awaiting.current.get(originId)
    if (cycle) {
      cycle.applied = cycle.applied.filter((rid) => rid !== reviewerId)
      cycle.queue = cycle.queue.filter((q) => q.reviewerId !== reviewerId)
    }
    apply((s) => removeTerminal(s, reviewer.id))
    setStatus(reviewer.id, undefined)
    removed.current.add(reviewerId)
    const others = findReviewersFor(state, originId)
      .filter((r) => r.id !== reviewerId && !removed.current.has(r.id))
    if (others.length === 0) {
      awaiting.current.delete(originId)
      setStatus(originId, undefined)
    }
  }, [state, apply, setStatus])

  return { startReview, handleFsChanged, handleBusy, moreRounds, acceptPhase, stopLoop }
}

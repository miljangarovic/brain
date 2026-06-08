import { useRef, useCallback } from 'react'
import type { AppState } from '../store'
import { addTerminal, setReviewRound, findReviewerFor, featureIdOfTerminal, getTerminalById } from '../store'
import type { ReviewKind, ReviewStatus } from '@shared/types'
import { createId } from '@shared/id'
import { AGENTS, type AgentKind } from '../agents'
import { buildReviewerCommand, reviewerPrompt, relayToOriginPrompt, reReviewPrompt } from './prompt'

export interface StartReviewArgs {
  originTerminalId: string
  reviewer: AgentKind
  kind: ReviewKind
  specPath?: string
  intent?: string
}

interface WatchTarget { terminalId: string; status: ReviewStatus }

export function useReview(
  state: AppState,
  apply: (fn: (s: AppState) => AppState) => void,
  setStatus: (id: string, status: ReviewStatus | undefined) => void
) {
  // watchId → which terminal becomes which status when its file changes.
  const targets = useRef(new Map<string, WatchTarget>())

  const armWatch = useCallback((watchId: string, path: string, target: WatchTarget) => {
    targets.current.set(watchId, target)
    window.terminaltor.watchFile(watchId, path)
  }, [])

  // App subscribes this to window.terminaltor.onFsChanged.
  const handleFsChanged = useCallback((watchId: string) => {
    const t = targets.current.get(watchId)
    if (!t) return
    targets.current.delete(watchId)
    window.terminaltor.unwatchFile(watchId)
    setStatus(t.terminalId, t.status)
  }, [setStatus])

  const startReview = useCallback(async (a: StartReviewArgs) => {
    const featureId = featureIdOfTerminal(state, a.originTerminalId)
    if (!featureId) return
    const round = 1
    const { reviewDir, reviewFile } = await window.terminaltor.resolveReviewDir(a.originTerminalId, round)
    const prompt = reviewerPrompt({ kind: a.kind, specPath: a.specPath, reviewFile, intent: a.intent })
    const startupCommand = buildReviewerCommand(AGENTS[a.reviewer].command, prompt)
    const reviewerId = createId()
    apply((s) => addTerminal(s, featureId, {
      id: reviewerId,
      name: `review: ${a.reviewer}`,
      kind: a.reviewer,
      startupCommand,
      review: { originTerminalId: a.originTerminalId, reviewKind: a.kind, specPath: a.specPath, reviewDir, round }
    }))
    setStatus(reviewerId, 'reviewing')
    armWatch(`review:${reviewerId}:${round}`, reviewFile, { terminalId: reviewerId, status: 'review-ready' })
  }, [state, apply, setStatus, armWatch])

  const relayToOrigin = useCallback(async (reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!link) return
    const { reviewFile } = await window.terminaltor.resolveReviewDir(link.originTerminalId, link.round)
    const text = relayToOriginPrompt({ kind: link.reviewKind, reviewFile, specPath: link.specPath })
    window.terminaltor.writePty(link.originTerminalId, text + '\r')
    setStatus(reviewerId, undefined)
    setStatus(link.originTerminalId, 'applying')
    // Auto status for 'spec' only (single file to watch). 'impl' → manual mark (UI).
    if (link.reviewKind === 'spec' && link.specPath) {
      armWatch(`spec:${link.originTerminalId}:${link.round}`, link.specPath,
        { terminalId: link.originTerminalId, status: 'iteration-done' })
    }
  }, [state, setStatus, armWatch])

  const reReview = useCallback(async (originId: string) => {
    const reviewer = findReviewerFor(state, originId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const round = link.round + 1
    const { reviewFile } = await window.terminaltor.resolveReviewDir(originId, round)
    const text = reReviewPrompt({ kind: link.reviewKind, specPath: link.specPath, reviewFile })
    window.terminaltor.writePty(reviewer.id, text + '\r')
    apply((s) => setReviewRound(s, reviewer.id, round))
    setStatus(originId, undefined)
    setStatus(reviewer.id, 'reviewing')
    armWatch(`review:${reviewer.id}:${round}`, reviewFile, { terminalId: reviewer.id, status: 'review-ready' })
  }, [state, apply, setStatus, armWatch])

  const markApplied = useCallback((originId: string) => setStatus(originId, 'iteration-done'), [setStatus])

  return { startReview, relayToOrigin, reReview, markApplied, handleFsChanged }
}

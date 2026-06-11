import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AppState } from '../store'
import type { ReviewStatus } from '@shared/types'
import { registerTail, unregisterTail } from '../attention/tailRegistry'

const api = {
  watchFile: vi.fn(),
  unwatchFile: vi.fn(),
  readTextFile: vi.fn(async (): Promise<string | null> => null),
  writePty: vi.fn(),
  resolveReviewDir: vi.fn(async (_origin: string, phase: string, round: number) => ({
    reviewDir: '/rd',
    reviewFile: `/rd/review-${phase}-${round}.md`,
    intentPath: '/rd/intent.md',
    specPath: '/rd/spec.md'
  })),
  resolveTranscript: vi.fn(async () => null),
  captureAgentSession: vi.fn(async (): Promise<string | null> => null)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.readTextFile.mockResolvedValue(null)
  ;(window as unknown as { brain: typeof api }).brain = api
})
afterEach(() => {
  unregisterTail('origin')
})

// Import after the window.brain shape is established.
import { useReview } from './useReview'

// A workspace restored from disk: an origin agent plus its reviewer terminal
// carrying a persisted review link (round 2 of the impl phase).
const mkState = (withReviewer = true): AppState => ({
  workspace: {
    groups: [{
      id: 'g', name: 'G', cwd: '/p', collapsed: false,
      features: [{
        id: 'f', name: 'F', collapsed: false,
        terminals: [
          { id: 'origin', name: 'claude', cwd: '/p', kind: 'claude' },
          ...(withReviewer ? [{
            id: 'rev', name: 'review: codex', cwd: '/p', kind: 'codex' as const,
            review: { originTerminalId: 'origin', phase: 'impl' as const, round: 2, maxRounds: 3, reviewDir: '/rd' }
          }] : [])
        ]
      }]
    }]
  },
  activeGroupId: 'g', activeFeatureId: 'f', activeTerminalId: 'origin', hidden: []
})

const WATCH_ID = 'review:rev:impl:2'
const REVIEW_FILE = '/rd/review-impl-2.md'

function setup(opts: { state?: AppState; reviewStatus?: Record<string, ReviewStatus | undefined> } = {}) {
  const apply = vi.fn()
  const setStatus = vi.fn()
  const hook = renderHook(
    (p: { state: AppState; reviewStatus: Record<string, ReviewStatus | undefined> }) =>
      useReview(p.state, apply, setStatus, p.reviewStatus),
    { initialProps: { state: opts.state ?? mkState(), reviewStatus: opts.reviewStatus ?? {} } }
  )
  return { ...hook, apply, setStatus }
}

describe('useReview recovery (re-arm after renderer reload)', () => {
  it('re-arms the verdict watch for a persisted review link', async () => {
    const { setStatus } = setup()
    await act(async () => {})
    expect(api.watchFile).toHaveBeenCalledWith(WATCH_ID, REVIEW_FILE)
    expect(setStatus).toHaveBeenCalledWith('rev', 'reviewing')
    expect(setStatus).toHaveBeenCalledWith('origin', 'under-review')
    expect(api.unwatchFile).not.toHaveBeenCalled() // no verdict yet → stays watching
  })

  it('processes a verdict that landed while the renderer was away', async () => {
    api.readTextFile.mockResolvedValue('VERDICT: APPROVED\nlooks good')
    const { apply, setStatus } = setup()
    await act(async () => {})
    expect(api.unwatchFile).toHaveBeenCalledWith(WATCH_ID)
    expect(setStatus).toHaveBeenCalledWith('origin', 'approved')
    expect(apply).toHaveBeenCalled() // reviewer terminal removed
  })

  it('does not re-arm a reviewer whose loop is alive in this renderer', async () => {
    setup({ reviewStatus: { rev: 'needs-decision' } })
    await act(async () => {})
    expect(api.watchFile).not.toHaveBeenCalled()
  })

  it('reaps the watch when the reviewer terminal leaves the workspace', async () => {
    const { rerender } = setup()
    await act(async () => {})
    expect(api.watchFile).toHaveBeenCalledWith(WATCH_ID, REVIEW_FILE)
    rerender({ state: mkState(false), reviewStatus: {} })
    await act(async () => {})
    expect(api.unwatchFile).toHaveBeenCalledWith(WATCH_ID)
  })
})

describe('useReview verdict gating', () => {
  it('keeps watching while the review file has no valid verdict line yet', async () => {
    const { result } = setup()
    await act(async () => {})
    api.readTextFile.mockResolvedValue('## Review\nstill being written')
    await act(() => result.current.handleFsChanged(WATCH_ID))
    expect(api.unwatchFile).not.toHaveBeenCalled()

    api.readTextFile.mockResolvedValue('VERDICT: NEEDS-WORK\n- fix x')
    await act(() => result.current.handleFsChanged(WATCH_ID))
    expect(api.unwatchFile).toHaveBeenCalledWith(WATCH_ID)
    expect(api.writePty).toHaveBeenCalled() // critique relayed into the origin
  })
})

describe('useReview reviewer naming', () => {
  it('names the reviewer terminal after the origin terminal, not the reviewer agent', async () => {
    const state = mkState(false)
    state.workspace.groups[0].features[0].terminals[0].name = 'auth-api'
    const { result, apply } = setup({ state })
    await act(async () => {})
    await act(() => result.current.startReview({ originTerminalId: 'origin', reviewer: 'codex', phase: 'impl', maxRounds: 3 }))
    const updater = apply.mock.calls.at(-1)![0]
    const next = updater(mkState(false))
    const reviewer = next.workspace.groups[0].features[0].terminals.find((t: { review?: unknown }) => t.review)
    expect(reviewer?.name).toBe('review: auth-api')
  })
})

describe('useReview reviewer session pinning', () => {
  it('pins a claude reviewer session id at spawn (no --continue fallback on restore)', async () => {
    const { result, apply } = setup({ state: mkState(false) })
    await act(async () => {})
    await act(() => result.current.startReview({ originTerminalId: 'origin', reviewer: 'claude', phase: 'impl', maxRounds: 3 }))
    const updater = apply.mock.calls.at(-1)![0]
    const next = updater(mkState(false))
    const reviewer = next.workspace.groups[0].features[0].terminals.find((t: { review?: unknown }) => t.review)
    expect(reviewer?.sessionId).toBeTruthy()
    expect(reviewer?.startupCommand).toContain(`claude --session-id ${reviewer?.sessionId} '`)
  })

  it('detects and stores a codex reviewer session id after launch', async () => {
    api.captureAgentSession.mockResolvedValueOnce('sid-123')
    const { result, apply } = setup({ state: mkState(false) })
    await act(async () => {})
    await act(() => result.current.startReview({ originTerminalId: 'origin', reviewer: 'codex', phase: 'impl', maxRounds: 3 }))
    await act(async () => {}) // let the capture promise settle
    expect(api.captureAgentSession).toHaveBeenCalledWith(expect.objectContaining({ kind: 'codex', cwd: '/p' }))
    const afterAdd = apply.mock.calls[0][0](mkState(false))
    const afterSid = apply.mock.calls.at(-1)![0](afterAdd)
    const reviewer = afterSid.workspace.groups[0].features[0].terminals.find((t: { review?: unknown }) => t.review)
    expect(reviewer?.sessionId).toBe('sid-123')
  })
})

describe('useReview apply-hold on a blocked origin', () => {
  // Drive the loop to "origin is applying a NEEDS-WORK critique".
  async function reachApplying(result: { current: ReturnType<typeof useReview> }) {
    api.readTextFile.mockResolvedValue('VERDICT: NEEDS-WORK\n- fix x')
    await act(() => result.current.handleFsChanged(WATCH_ID))
  }

  it('does not advance the round while the origin tail shows a permission prompt', async () => {
    const { result } = setup()
    await act(async () => {})
    await reachApplying(result)

    registerTail('origin', () => 'Do you want to proceed? (y/n)')
    await act(() => result.current.handleBusy('origin', true))
    await act(() => result.current.handleBusy('origin', false))
    expect(api.resolveReviewDir).not.toHaveBeenCalled() // held — origin is blocked on the user

    registerTail('origin', () => 'All changes applied.')
    await act(() => result.current.handleBusy('origin', true))
    await act(() => result.current.handleBusy('origin', false))
    expect(api.resolveReviewDir).toHaveBeenCalledWith('origin', 'impl', 3) // now it advances
  })
})

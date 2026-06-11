import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AppState } from '../store'
import type { RecorderHandle } from './recorder'

const startRecording = vi.fn<(opts: unknown) => Promise<RecorderHandle>>()
vi.mock('./recorder', () => ({
  startRecording: (opts: unknown) => startRecording(opts)
}))

const brain = {
  sendVoiceAudio: vi.fn(),
  cancelVoice: vi.fn(),
  onVoiceStart: vi.fn(() => () => {}),
  onVoiceState: vi.fn(() => () => {}),
  onVoiceResult: vi.fn(() => () => {})
}
beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { brain: typeof brain }).brain = brain
})

// Import after the window.brain shape is established.
import { useVoice } from './useVoice'

const mkState = (): AppState => ({
  workspace: {
    groups: [{
      id: 'g', name: 'G', cwd: '/p', collapsed: false,
      features: [{
        id: 'f', name: 'F', collapsed: false,
        terminals: [{ id: 't', name: 'claude', cwd: '/p', kind: 'claude' }]
      }]
    }]
  },
  activeGroupId: 'g', activeFeatureId: 'f', activeTerminalId: 't', hidden: []
})

const mkRec = (): RecorderHandle => ({
  stop: vi.fn(async () => new Float32Array(16000)),   // a healthy 1 s take
  cancel: vi.fn()
})

function setup() {
  return renderHook(() => useVoice({
    state: mkState(),
    apply: vi.fn(),
    markStarted: vi.fn(),
    stopReviewLoop: vi.fn(),
    launchAgent: vi.fn(),
    liveAgents: {},
    sendPrompt: vi.fn()
  }))
}

describe('push-to-talk', () => {
  it('pressStart records with VAD auto-stop disabled', async () => {
    startRecording.mockResolvedValue(mkRec())
    const h = setup()
    await act(async () => { h.result.current.pressStart() })
    expect(startRecording).toHaveBeenCalledWith(expect.objectContaining({ vadAutoStop: false }))
    expect(h.result.current.ui.kind).toBe('listening')
  })

  it('pressEnd finishes the take and ships the audio', async () => {
    const rec = mkRec()
    startRecording.mockResolvedValue(rec)
    const h = setup()
    await act(async () => { h.result.current.pressStart() })
    await act(async () => { h.result.current.pressEnd() })
    expect(rec.stop).toHaveBeenCalled()
    expect(brain.sendVoiceAudio).toHaveBeenCalled()
    expect(h.result.current.ui.kind).toBe('processing')
  })

  it('pressEnd while idle is a no-op', async () => {
    const h = setup()
    await act(async () => { h.result.current.pressEnd() })
    expect(startRecording).not.toHaveBeenCalled()
    expect(brain.sendVoiceAudio).not.toHaveBeenCalled()
    expect(h.result.current.ui.kind).toBe('idle')
  })

  it('release before the mic resolves still ends the take', async () => {
    let resolveRec!: (r: RecorderHandle) => void
    startRecording.mockReturnValue(new Promise<RecorderHandle>((r) => { resolveRec = r }))
    const rec = mkRec()
    ;(rec.stop as ReturnType<typeof vi.fn>).mockResolvedValue(null)   // sub-0.4 s click
    const h = setup()
    await act(async () => { h.result.current.pressStart() })
    await act(async () => { h.result.current.pressEnd() })            // button already up
    await act(async () => { resolveRec(rec) })
    expect(rec.stop).toHaveBeenCalled()
    expect(h.result.current.ui.kind).toBe('idle')                     // null pcm → silent dismiss
  })

  it('pressStart cancels an in-flight recording and starts fresh', async () => {
    const first = mkRec()
    const second = mkRec()
    startRecording.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const h = setup()
    await act(async () => { h.result.current.pressStart() })
    await act(async () => { h.result.current.pressStart() })
    expect(first.cancel).toHaveBeenCalled()
    expect(brain.cancelVoice).toHaveBeenCalled()
    expect(startRecording).toHaveBeenCalledTimes(2)
    expect(h.result.current.ui.kind).toBe('listening')
  })
})

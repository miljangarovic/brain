import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startRecording } from './recorder'

class FakeWorkletNode {
  port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null }
  connect = vi.fn()
  disconnect = vi.fn()
  constructor() { lastNode = this }
}
let lastNode: FakeWorkletNode | null = null

class FakeAudioContext {
  sampleRate = 16000
  audioWorklet = { addModule: vi.fn(async () => {}) }
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
  close = vi.fn(async () => {})
}

const track = { stop: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  lastNode = null
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) }
  })
  URL.createObjectURL = vi.fn(() => 'blob:voice-capture')
  URL.revokeObjectURL = vi.fn()
})

// 1 s of speech / silence at the fake 16 kHz rate.
const loud = () => new Float32Array(16000).fill(0.5)
const silent = () => new Float32Array(16000)
const push = (c: Float32Array) => lastNode!.port.onmessage!({ data: c })

describe('startRecording VAD gating', () => {
  it('auto-stops on silence after speech by default', async () => {
    const onAutoStop = vi.fn()
    await startRecording({ onAutoStop })
    push(loud())               // 1 s speech ≥ minSpeechMs 250
    push(silent())
    push(silent())             // 2 s silence ≥ holdMs 1200
    expect(onAutoStop).toHaveBeenCalledTimes(1)
  })

  it('vadAutoStop: false never fires onAutoStop, audio still accumulates', async () => {
    const onAutoStop = vi.fn()
    const rec = await startRecording({ onAutoStop, vadAutoStop: false })
    push(loud())
    push(silent())
    push(silent())
    expect(onAutoStop).not.toHaveBeenCalled()
    const pcm = await rec.stop()
    expect(pcm).toHaveLength(48000)          // all 3 s kept
  })

  it('keeps the sub-0.4 s misfire guard regardless of mode', async () => {
    const rec = await startRecording({ onAutoStop: vi.fn(), vadAutoStop: false })
    push(new Float32Array(1600))             // 0.1 s
    expect(await rec.stop()).toBeNull()
  })
})

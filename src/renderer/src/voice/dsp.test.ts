import { describe, it, expect } from 'vitest'
import { concatFloat32, downsample, rms, SilenceTracker } from './dsp'

const zeros = (n: number) => new Float32Array(n)
const tone = (n: number, amp = 0.5) => {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * 440 * i) / 48000)
  return a
}

describe('concatFloat32', () => {
  it('concatenates chunks in order', () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3])])
    expect(Array.from(out)).toEqual([1, 2, 3])
  })
})

describe('downsample', () => {
  it('48k → 16k yields one third of the samples', () => {
    expect(downsample(zeros(4800), 48000, 16000).length).toBe(1600)
  })
  it('same rate returns input unchanged', () => {
    const input = tone(100)
    expect(downsample(input, 16000, 16000)).toBe(input)
  })
  it('preserves a constant signal', () => {
    const out = downsample(new Float32Array(90).fill(0.25), 48000, 16000)
    for (const v of out) expect(v).toBeCloseTo(0.25, 5)
  })
})

describe('rms', () => {
  it('is 0 for silence and >0 for a tone', () => {
    expect(rms(zeros(1024))).toBe(0)
    expect(rms(tone(1024))).toBeGreaterThan(0.1)
  })
})

describe('SilenceTracker', () => {
  // 48000 samples/s; chunks of 4800 = 100ms each.
  const chunkMs = (t: SilenceTracker, ms: number, silent: boolean) => {
    let last: 'continue' | 'stop' = 'continue'
    for (let i = 0; i < ms / 100; i++) last = t.push(silent ? zeros(4800) : tone(4800))
    return last
  }
  it('does not stop during initial silence (no speech yet)', () => {
    const t = new SilenceTracker({ sampleRate: 48000 })
    expect(chunkMs(t, 3000, true)).toBe('continue')
  })
  it('stops after holdMs of silence once speech was heard', () => {
    const t = new SilenceTracker({ sampleRate: 48000, holdMs: 1200, minSpeechMs: 250 })
    expect(chunkMs(t, 500, false)).toBe('continue')   // speech
    expect(chunkMs(t, 1100, true)).toBe('continue')   // not yet 1200ms silence
    expect(chunkMs(t, 200, true)).toBe('stop')
  })
  it('speech resets the silence run', () => {
    const t = new SilenceTracker({ sampleRate: 48000, holdMs: 1200, minSpeechMs: 250 })
    chunkMs(t, 500, false)
    chunkMs(t, 1000, true)
    chunkMs(t, 200, false)                            // speech again
    expect(chunkMs(t, 1100, true)).toBe('continue')
  })
  it('hard-stops at maxMs regardless of speech', () => {
    const t = new SilenceTracker({ sampleRate: 48000, maxMs: 2000 })
    expect(chunkMs(t, 2100, false)).toBe('stop')
  })
})

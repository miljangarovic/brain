// Pure DSP helpers for the voice recorder. Kept free of Web Audio types so
// they are unit-testable in jsdom/node.

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

// Linear-interpolation resampler — fine for speech into whisper's 16 kHz.
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const outLen = Math.floor((input.length * toRate) / fromRate)
  const out = new Float32Array(outLen)
  const ratio = fromRate / toRate
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0)
  }
  return out
}

export function rms(chunk: Float32Array): number {
  let sum = 0
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
  return Math.sqrt(sum / (chunk.length || 1))
}

// Auto-stop policy: never stop before any speech was heard (the user may take
// a moment to start talking); once cumulative speech ≥ minSpeechMs, holdMs of
// continuous silence ends the recording. maxMs is the hard cap.
export class SilenceTracker {
  private readonly sampleRate: number
  private readonly threshold: number
  private readonly holdMs: number
  private readonly minSpeechMs: number
  private readonly maxMs: number
  private elapsedMs = 0
  private speechMs = 0
  private silenceRunMs = 0

  constructor(opts: { sampleRate: number; threshold?: number; holdMs?: number; minSpeechMs?: number; maxMs?: number }) {
    this.sampleRate = opts.sampleRate
    this.threshold = opts.threshold ?? 0.015
    this.holdMs = opts.holdMs ?? 1200
    this.minSpeechMs = opts.minSpeechMs ?? 250
    this.maxMs = opts.maxMs ?? 20000
  }

  push(chunk: Float32Array): 'continue' | 'stop' {
    const ms = (chunk.length / this.sampleRate) * 1000
    this.elapsedMs += ms
    if (rms(chunk) >= this.threshold) { this.speechMs += ms; this.silenceRunMs = 0 }
    else this.silenceRunMs += ms
    if (this.elapsedMs >= this.maxMs) return 'stop'
    if (this.speechMs >= this.minSpeechMs && this.silenceRunMs >= this.holdMs) return 'stop'
    return 'continue'
  }
}

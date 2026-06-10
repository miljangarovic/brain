// Microphone capture: getUserMedia → AudioWorklet (loaded from a Blob URL so
// no extra build entry is needed) → Float32 chunks accumulate here, with the
// SilenceTracker deciding auto-stop. stop() returns 16 kHz mono PCM ready for
// whisper; cancel() tears everything down and discards the audio.
import { concatFloat32, downsample, SilenceTracker } from './dsp'

const WORKLET_SOURCE = `
class VoiceCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('voice-capture', VoiceCapture)
`

export interface RecorderHandle {
  // Resolves with 16 kHz mono PCM, or null when almost nothing was recorded.
  stop(): Promise<Float32Array | null>
  cancel(): void
}

export async function startRecording(opts: { onAutoStop: () => void }): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  })
  const ctx = new AudioContext()
  const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(workletUrl)
  } finally {
    URL.revokeObjectURL(workletUrl)
  }

  const chunks: Float32Array[] = []
  const tracker = new SilenceTracker({ sampleRate: ctx.sampleRate })
  let done = false
  let autoStopFired = false

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'voice-capture')
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (done) return
    chunks.push(e.data)
    if (!autoStopFired && tracker.push(e.data) === 'stop') {
      autoStopFired = true
      opts.onAutoStop()
    }
  }
  source.connect(node)
  // No connection to ctx.destination — capture only, no monitoring loopback.

  const teardown = () => {
    done = true
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  return {
    stop: async () => {
      const sampleRate = ctx.sampleRate
      teardown()
      const pcm = downsample(concatFloat32(chunks), sampleRate, 16000)
      // Under ~0.4s is a misfire (key bounce, instant second press) — drop it.
      return pcm.length < 16000 * 0.4 ? null : pcm
    },
    cancel: teardown
  }
}

import type { AttentionState } from './detect'

const KEY = 'attentionMuted'

export function isMuted(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export function setMuted(muted: boolean): void {
  try { localStorage.setItem(KEY, muted ? '1' : '0') } catch { /* ignore */ }
}

// Short Web Audio beep — a lower tone for errors. No-op when muted or when the
// browser blocks/omits AudioContext (e.g. autoplay policy, jsdom in tests).
export function beep(state: AttentionState): void {
  if (isMuted()) return
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = state === 'error' ? 220 : 660
    osc.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.05, ctx.currentTime)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
    osc.onended = () => { try { void ctx.close() } catch { /* ignore */ } }
  } catch { /* ignore */ }
}

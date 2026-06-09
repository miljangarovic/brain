// src/renderer/src/attention/notify.ts
import type { AttentionState } from './detect'

// Human-facing OS-notification title for a terminal entering an attention state.
export function notifTitle(state: AttentionState, name: string): string {
  if (state === 'waiting-input') return `${name} čeka tvoj odgovor`
  if (state === 'error') return `${name} je pao`
  return `${name} je gotov`
}

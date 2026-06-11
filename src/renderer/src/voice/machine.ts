// Pure UI state machine for the voice overlay. Side effects (recorder, IPC,
// executing plans) live in useVoice — this reducer only answers "what is on
// screen". Errors ALWAYS surface (the startup "shortcut taken" warning
// arrives while idle); other stray events outside an active flow are ignored
// (main gen-guards canceled generations, so progress events cannot resurrect
// a canceled flow anyway).
import type { VoiceStateEvent } from '@shared/voice'
import type { ExecDescriptor } from './executor'

export type VoiceUiState =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'processing'; label: string; transcript?: string }
  | { kind: 'downloading'; received: number; total: number | null }
  | { kind: 'confirm'; transcript: string; summary: string; descriptor: ExecDescriptor; editablePrompt?: string }
  | { kind: 'toast'; text: string }
  | { kind: 'error'; message: string; transcript?: string }

export type VoiceUiEvent =
  | { type: 'listen' }
  | { type: 'audio-sent' }
  | { type: 'state'; ev: VoiceStateEvent }
  | { type: 'executed'; toast: string }
  | { type: 'confirm'; transcript: string; summary: string; descriptor: ExecDescriptor; editablePrompt?: string }
  | { type: 'plan-error'; message: string; transcript?: string }
  | { type: 'mic-error'; message: string }
  | { type: 'dismiss' }

export const IDLE: VoiceUiState = { kind: 'idle' }

const active = (s: VoiceUiState) => s.kind === 'processing' || s.kind === 'downloading'

export function reduceVoice(s: VoiceUiState, e: VoiceUiEvent): VoiceUiState {
  switch (e.type) {
    case 'listen': return { kind: 'listening' }
    case 'dismiss': return IDLE
    case 'mic-error': return { kind: 'error', message: e.message }
    case 'audio-sent': return s.kind === 'listening' ? { kind: 'processing', label: 'Transcribing…' } : s
    case 'state': {
      if (e.ev.phase === 'error') {
        return { kind: 'error', message: e.ev.message, ...(e.ev.transcript ? { transcript: e.ev.transcript } : {}) }
      }
      if (!active(s)) return s
      switch (e.ev.phase) {
        case 'transcribing': return { kind: 'processing', label: 'Transcribing…' }
        case 'parsing': return { kind: 'processing', label: 'Parsing…', transcript: e.ev.transcript }
        case 'downloading-model': return { kind: 'downloading', received: e.ev.received, total: e.ev.total }
      }
      return s
    }
    // executed also fires from confirm — the user pressed Enter in the modal.
    case 'executed': return active(s) || s.kind === 'confirm' ? { kind: 'toast', text: e.toast } : s
    case 'confirm': return active(s)
      ? { kind: 'confirm', transcript: e.transcript, summary: e.summary, descriptor: e.descriptor, ...(e.editablePrompt ? { editablePrompt: e.editablePrompt } : {}) }
      : s
    case 'plan-error': return active(s) ? { kind: 'error', message: e.message, ...(e.transcript ? { transcript: e.transcript } : {}) } : s
  }
}

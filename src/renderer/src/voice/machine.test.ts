import { describe, it, expect } from 'vitest'
import { reduceVoice, IDLE, type VoiceUiState } from './machine'
import type { ExecDescriptor } from './executor'

const desc: ExecDescriptor = { type: 'closeTerminal', terminalId: 't1' }

describe('reduceVoice', () => {
  it('idle → listening on listen', () => {
    expect(reduceVoice(IDLE, { type: 'listen' })).toEqual({ kind: 'listening' })
  })
  it('listening → processing on audio-sent', () => {
    expect(reduceVoice({ kind: 'listening' }, { type: 'audio-sent' }))
      .toEqual({ kind: 'processing', label: 'Transcribing…' })
  })
  it('voice:state events update the processing label / download progress', () => {
    const p: VoiceUiState = { kind: 'processing', label: 'Transcribing…' }
    expect(reduceVoice(p, { type: 'state', ev: { phase: 'downloading-model', received: 5, total: 10 } }))
      .toEqual({ kind: 'downloading', received: 5, total: 10 })
    expect(reduceVoice(p, { type: 'state', ev: { phase: 'parsing', transcript: 'prebaci' } }))
      .toEqual({ kind: 'processing', label: 'Parsing…', transcript: 'prebaci' })
    expect(reduceVoice(p, { type: 'state', ev: { phase: 'error', message: 'boom', transcript: 'x' } }))
      .toEqual({ kind: 'error', message: 'boom', transcript: 'x' })
  })
  it('plan run → toast; plan confirm → confirm; plan error → error', () => {
    const p: VoiceUiState = { kind: 'processing', label: 'Parsing…' }
    expect(reduceVoice(p, { type: 'executed', toast: '→ file-panes' })).toEqual({ kind: 'toast', text: '→ file-panes' })
    expect(reduceVoice(p, {
      type: 'confirm', transcript: 'zatvori', summary: 'Close terminal "shell"', descriptor: desc
    })).toEqual({ kind: 'confirm', transcript: 'zatvori', summary: 'Close terminal "shell"', descriptor: desc })
    expect(reduceVoice(p, { type: 'plan-error', message: 'nope', transcript: 'zzz' }))
      .toEqual({ kind: 'error', message: 'nope', transcript: 'zzz' })
  })
  it('confirm → toast on executed (user pressed Enter)', () => {
    const c: VoiceUiState = { kind: 'confirm', transcript: 't', summary: 's', descriptor: desc }
    expect(reduceVoice(c, { type: 'executed', toast: 'Terminal closed' }))
      .toEqual({ kind: 'toast', text: 'Terminal closed' })
  })
  it('mic-error is reachable from idle (getUserMedia rejected)', () => {
    expect(reduceVoice(IDLE, { type: 'mic-error', message: 'Microphone unavailable' }))
      .toEqual({ kind: 'error', message: 'Microphone unavailable' })
  })
  it('dismiss returns to idle from any state', () => {
    for (const st of [
      { kind: 'listening' }, { kind: 'toast', text: 'x' },
      { kind: 'error', message: 'm' }, { kind: 'confirm', transcript: 't', summary: 's', descriptor: desc }
    ] as VoiceUiState[]) {
      expect(reduceVoice(st, { type: 'dismiss' })).toEqual(IDLE)
    }
  })
  it('stray NON-ERROR events in idle stay idle', () => {
    expect(reduceVoice(IDLE, { type: 'state', ev: { phase: 'transcribing' } })).toEqual(IDLE)
    expect(reduceVoice(IDLE, { type: 'executed', toast: 'x' })).toEqual(IDLE)
  })
  it('error phase surfaces even from idle (startup shortcut warning)', () => {
    expect(reduceVoice(IDLE, { type: 'state', ev: { phase: 'error', message: 'shortcut taken' } }))
      .toEqual({ kind: 'error', message: 'shortcut taken' })
  })
})

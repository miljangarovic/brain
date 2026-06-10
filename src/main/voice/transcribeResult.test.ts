import { describe, it, expect } from 'vitest'
import { extractTranscript } from './transcribeResult'

describe('extractTranscript', () => {
  it('joins whisper.cpp segment triplets [from, to, text]', () => {
    expect(extractTranscript({ transcription: [['00:00', '00:02', ' prebaci na'], ['00:02', '00:03', ' file panes']] }))
      .toBe('prebaci na file panes')
  })
  it('accepts a bare segments array', () => {
    expect(extractTranscript([['0', '1', 'dodaj terminal']])).toBe('dodaj terminal')
  })
  it('accepts a plain string', () => {
    expect(extractTranscript('zatvori grid ')).toBe('zatvori grid')
  })
  it('anything else → empty string', () => {
    expect(extractTranscript(undefined)).toBe('')
    expect(extractTranscript({ foo: 1 })).toBe('')
  })
  it('accepts flat string segments (no_timestamps variant)', () => {
    expect(extractTranscript({ transcription: ['prebaci ', 'na grid'] })).toBe('prebaci na grid')
  })
})

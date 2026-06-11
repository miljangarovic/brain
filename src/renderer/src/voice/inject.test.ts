import { describe, it, expect } from 'vitest'
import { envelopePrompt } from './inject'

describe('envelopePrompt', () => {
  it('single-line passes through unchanged', () => {
    expect(envelopePrompt('sredi testove')).toBe('sredi testove')
  })
  it('multiline rides in a bracketed-paste envelope', () => {
    expect(envelopePrompt('line1\nline2')).toBe('\x1b[200~line1\nline2\x1b[201~')
  })
})

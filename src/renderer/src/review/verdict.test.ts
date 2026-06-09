import { describe, it, expect } from 'vitest'
import { parseVerdict } from './verdict'

describe('parseVerdict', () => {
  it('reads APPROVED from the first line', () => {
    expect(parseVerdict('VERDICT: APPROVED\nlooks good')).toBe('approved')
  })
  it('reads NEEDS-WORK from the first line', () => {
    expect(parseVerdict('VERDICT: NEEDS-WORK\n- fix x')).toBe('needs-work')
  })
  it('is case-insensitive and ignores leading blank lines', () => {
    expect(parseVerdict('\n\n  verdict: approved  \n')).toBe('approved')
  })
  it('treats trailing prose after APPROVED as approved', () => {
    expect(parseVerdict('VERDICT: APPROVED — minor nits only')).toBe('approved')
  })
  it('defaults to needs-work when the verdict line is missing', () => {
    expect(parseVerdict('I think this is mostly fine')).toBe('needs-work')
  })
  it('defaults to needs-work on empty input', () => {
    expect(parseVerdict('')).toBe('needs-work')
  })
})

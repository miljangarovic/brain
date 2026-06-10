import { describe, it, expect } from 'vitest'
import { parseVerdictStrict } from './verdict'

describe('parseVerdictStrict', () => {
  it('reads APPROVED from the first line', () => {
    expect(parseVerdictStrict('VERDICT: APPROVED\nlooks good')).toBe('approved')
  })
  it('reads NEEDS-WORK from the first line', () => {
    expect(parseVerdictStrict('VERDICT: NEEDS-WORK\n- fix x')).toBe('needs-work')
  })
  it('is case-insensitive and ignores leading blank lines', () => {
    expect(parseVerdictStrict('\n\n  verdict: approved  \n')).toBe('approved')
  })
  it('treats trailing prose after APPROVED as approved', () => {
    expect(parseVerdictStrict('VERDICT: APPROVED — minor nits only')).toBe('approved')
  })
  it('returns null when the verdict line is missing (file still being written)', () => {
    expect(parseVerdictStrict('I think this is mostly fine')).toBeNull()
  })
  it('returns null for an empty file (partial write in progress)', () => {
    expect(parseVerdictStrict('')).toBeNull()
  })
})

// src/renderer/src/attention/detect.test.ts
import { describe, it, expect } from 'vitest'
import { stripAnsi, classifyIdle } from './detect'

describe('stripAnsi', () => {
  it('removes CSI colour sequences', () => {
    expect(stripAnsi('\x1b[33mhi\x1b[0m')).toBe('hi')
  })
  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text')
  })
  it('leaves plain text untouched', () => {
    expect(stripAnsi('do you want to proceed?')).toBe('do you want to proceed?')
  })
})

describe('classifyIdle', () => {
  it('flags a (y/n) prompt as waiting-input', () => {
    expect(classifyIdle('Apply this change? (y/n)')).toBe('waiting-input')
  })
  it('flags a numbered choice menu as waiting-input', () => {
    expect(classifyIdle('  ❯ 1. Yes\n    2. No')).toBe('waiting-input')
  })
  it('flags a "Do you want" prompt even with colour codes', () => {
    expect(classifyIdle('\x1b[1mDo you want to allow this?\x1b[0m')).toBe('waiting-input')
  })
  it('treats ordinary trailing output as done', () => {
    expect(classifyIdle('All tests passed. 42 files changed.')).toBe('done')
  })
  it('treats empty input as done', () => {
    expect(classifyIdle('')).toBe('done')
  })
})

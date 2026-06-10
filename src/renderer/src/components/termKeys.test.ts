// src/renderer/src/components/termKeys.test.ts
import { describe, it, expect } from 'vitest'
import { classifyKeyEvent, type TermKeyEvent } from './termKeys'

const ev = (over: Partial<TermKeyEvent> = {}): TermKeyEvent => ({
  type: 'keydown', code: 'Enter',
  shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
  ...over,
})

describe('classifyKeyEvent', () => {
  it('maps Shift+Enter keydown to newline', () => {
    expect(classifyKeyEvent(ev({ shiftKey: true }))).toBe('newline')
    expect(classifyKeyEvent(ev({ shiftKey: true, code: 'NumpadEnter' }))).toBe('newline')
  })

  // The bug: the browser fires a keypress for Enter after an unprevented
  // keydown, and xterm's legacy keypress path turns it into '\r' (submit!)
  // unless the custom handler swallows it too.
  it('swallows the Shift+Enter keypress so xterm cannot emit a CR after our LF', () => {
    expect(classifyKeyEvent(ev({ type: 'keypress', shiftKey: true }))).toBe('swallow')
    expect(classifyKeyEvent(ev({ type: 'keyup', shiftKey: true }))).toBe('swallow')
  })

  it('lets plain Enter through untouched (submit)', () => {
    expect(classifyKeyEvent(ev())).toBe('pass')
    expect(classifyKeyEvent(ev({ type: 'keypress' }))).toBe('pass')
  })

  it('does not treat Ctrl/Alt/Meta+Shift+Enter as newline', () => {
    expect(classifyKeyEvent(ev({ shiftKey: true, ctrlKey: true }))).toBe('pass')
    expect(classifyKeyEvent(ev({ shiftKey: true, altKey: true }))).toBe('pass')
    expect(classifyKeyEvent(ev({ shiftKey: true, metaKey: true }))).toBe('pass')
  })

  it('maps Ctrl+Shift+C/V keydown to copy/paste', () => {
    expect(classifyKeyEvent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyC' }))).toBe('copy')
    expect(classifyKeyEvent(ev({ ctrlKey: true, shiftKey: true, code: 'KeyV' }))).toBe('paste')
  })

  it('passes other keypress/keyup events through', () => {
    expect(classifyKeyEvent(ev({ type: 'keypress', code: 'KeyA' }))).toBe('pass')
    expect(classifyKeyEvent(ev({ type: 'keyup', code: 'KeyA' }))).toBe('pass')
  })
})

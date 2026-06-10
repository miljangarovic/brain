import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBusyTracker } from './busyTracker'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('createBusyTracker', () => {
  it('emits busy=true once on first output, not again before idle', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    t.touch('a')
    expect(emit.mock.calls).toEqual([['a', true]])
  })

  it('emits busy=false after the idle window elapses', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    emit.mockClear()
    vi.advanceTimersByTime(600)
    expect(emit.mock.calls).toEqual([['a', false]])
  })

  it('re-arms: each touch pushes the idle deadline back', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    vi.advanceTimersByTime(400)
    t.touch('a')
    vi.advanceTimersByTime(400)
    expect(emit).toHaveBeenCalledTimes(1) // still busy
    vi.advanceTimersByTime(200)
    expect(emit).toHaveBeenLastCalledWith('a', false)
  })

  it('goes busy again after having gone idle', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a'); vi.advanceTimersByTime(600)
    emit.mockClear()
    t.touch('a')
    expect(emit.mock.calls).toEqual([['a', true]])
  })

  it('end() while busy emits false and cancels the pending idle timer', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    emit.mockClear()
    t.end('a')
    expect(emit.mock.calls).toEqual([['a', false]])
    vi.advanceTimersByTime(1000)
    expect(emit).toHaveBeenCalledTimes(1) // no spurious emit from old timer
  })

  it('end() while idle emits nothing', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.end('a')
    expect(emit).not.toHaveBeenCalled()
  })

  it('tracks ids independently', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600)
    t.touch('a')
    t.touch('b')
    expect(emit.mock.calls).toEqual([['a', true], ['b', true]])
  })

  it('suppresses busy while the user is typing (output is echo)', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400)
    t.input('a')
    t.touch('a')
    t.touch('a')
    expect(emit).not.toHaveBeenCalled()
  })

  it('input while busy hides the spinner immediately and cancels the idle timer', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400)
    t.touch('a')
    emit.mockClear()
    t.input('a')
    expect(emit.mock.calls).toEqual([['a', false]])
    vi.advanceTimersByTime(600) // stale idle timer must not fire a second false
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('resumes busy after the typing window elapses', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400)
    t.input('a')
    vi.advanceTimersByTime(400)
    emit.mockClear()
    t.touch('a')
    expect(emit.mock.calls).toEqual([['a', true]])
  })

  it('each keystroke re-arms the typing window', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400)
    t.input('a')
    vi.advanceTimersByTime(300)
    t.input('a')                 // resets the 400ms typing window
    vi.advanceTimersByTime(300)  // 300 < 400 → still typing
    t.touch('a')
    expect(emit).not.toHaveBeenCalled()
  })

  it('typing on one terminal does not suppress another', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400)
    t.input('a')
    t.touch('b')
    expect(emit.mock.calls).toEqual([['b', true]])
  })

  it('a resize repaint does not flip an idle terminal busy (no loader on grid toggle)', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400, 1000)
    t.resize('a')
    t.touch('a') // SIGWINCH repaint burst
    t.touch('a')
    expect(emit).not.toHaveBeenCalled()
  })

  it('a resize does not interrupt an in-flight busy phase', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400, 1000)
    t.touch('a') // genuinely working
    t.resize('a')
    t.touch('a') // work output keeps flowing
    expect(emit.mock.calls).toEqual([['a', true]]) // stays busy, no flicker
    vi.advanceTimersByTime(600)
    expect(emit).toHaveBeenLastCalledWith('a', false) // idles normally afterwards
  })

  it('resize suppression expires after the quiet window', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400, 1000)
    t.resize('a')
    vi.advanceTimersByTime(1000)
    t.touch('a')
    expect(emit.mock.calls).toEqual([['a', true]])
  })

  it('resize on one terminal does not suppress another', () => {
    const emit = vi.fn()
    const t = createBusyTracker(emit, 600, 400, 1000)
    t.resize('a')
    t.touch('b')
    expect(emit.mock.calls).toEqual([['b', true]])
  })
})

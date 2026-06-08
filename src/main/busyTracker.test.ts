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
})

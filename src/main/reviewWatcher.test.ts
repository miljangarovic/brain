import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dirname } from 'path'
import { createReviewWatcher, type WatchImpl } from './reviewWatcher'

// Fake watchImpl: capture listeners by directory so tests can fire events.
function makeFake() {
  const byDir = new Map<string, (filename: string | null) => void>()
  let closes = 0
  const impl: WatchImpl = (dir, listener) => {
    byDir.set(dir, listener)
    return { close: () => { closes++; byDir.delete(dir) } }
  }
  return { impl, fire: (dir: string, file: string | null) => byDir.get(dir)?.(file), closes: () => closes, dirs: () => [...byDir.keys()] }
}

describe('reviewWatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires onChanged once, debounced, when the watched file changes', () => {
    const fake = makeFake()
    const onChanged = vi.fn()
    const w = createReviewWatcher(onChanged, { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    fake.fire(dirname('/r/review-1.md'), 'review-1.md')
    fake.fire(dirname('/r/review-1.md'), 'review-1.md') // burst
    expect(onChanged).not.toHaveBeenCalled()            // still debouncing
    vi.advanceTimersByTime(400)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('wid')
  })

  it('ignores events for other filenames in the same dir', () => {
    const fake = makeFake()
    const onChanged = vi.fn()
    const w = createReviewWatcher(onChanged, { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    fake.fire('/r', 'other.md')
    vi.advanceTimersByTime(400)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('null filename (some platforms) still triggers', () => {
    const fake = makeFake()
    const onChanged = vi.fn()
    const w = createReviewWatcher(onChanged, { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    fake.fire('/r', null)
    vi.advanceTimersByTime(400)
    expect(onChanged).toHaveBeenCalledWith('wid')
  })

  it('unwatch closes the underlying watcher and stops events', () => {
    const fake = makeFake()
    const onChanged = vi.fn()
    const w = createReviewWatcher(onChanged, { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    w.unwatch('wid')
    expect(fake.closes()).toBe(1)
    fake.fire('/r', 'review-1.md')
    vi.advanceTimersByTime(400)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('re-watching the same id replaces the previous watcher', () => {
    const fake = makeFake()
    const w = createReviewWatcher(vi.fn(), { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    w.watch('wid', '/r/review-2.md')
    expect(fake.closes()).toBe(1)
    expect(fake.dirs()).toEqual(['/r'])
  })
})

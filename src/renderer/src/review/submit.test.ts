import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { submitToPty, SUBMIT_DELAY_MS } from './submit'

describe('submitToPty', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // @ts-expect-error minimal test stub
    window.orchestrix = { writePty: vi.fn() }
  })
  afterEach(() => vi.useRealTimers())

  it('writes the text immediately WITHOUT a trailing CR', () => {
    submitToPty('t1', 'apply the critique')
    expect(window.orchestrix.writePty).toHaveBeenCalledTimes(1)
    expect(window.orchestrix.writePty).toHaveBeenLastCalledWith('t1', 'apply the critique')
  })

  it('submits a lone CR as a separate keystroke after the delay', () => {
    submitToPty('t1', 'apply the critique')
    vi.advanceTimersByTime(SUBMIT_DELAY_MS)
    expect(window.orchestrix.writePty).toHaveBeenCalledTimes(2)
    expect(window.orchestrix.writePty).toHaveBeenLastCalledWith('t1', '\r')
  })
})

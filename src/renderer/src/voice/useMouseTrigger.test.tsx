import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { MouseTrigger } from '@shared/voice'
import { useMouseTrigger } from './useMouseTrigger'

const fire = (type: 'mousedown' | 'mouseup', button: number) => {
  const e = new MouseEvent(type, { button, cancelable: true })
  window.dispatchEvent(e)
  return e
}

function setup(trigger: MouseTrigger) {
  const h = { onDown: vi.fn(), onUp: vi.fn(), onCancel: vi.fn() }
  const hook = renderHook(() => useMouseTrigger(trigger, h))
  return { ...h, hook }
}

describe('useMouseTrigger', () => {
  it('forward → button 4 down/up cycle, default behavior suppressed', () => {
    const t = setup('forward')
    const down = fire('mousedown', 4)
    expect(t.onDown).toHaveBeenCalledTimes(1)
    expect(down.defaultPrevented).toBe(true)
    const up = fire('mouseup', 4)
    expect(t.onUp).toHaveBeenCalledTimes(1)
    expect(up.defaultPrevented).toBe(true)
    expect(t.onCancel).not.toHaveBeenCalled()
  })

  it('back → button 3', () => {
    const t = setup('back')
    fire('mousedown', 3)
    fire('mouseup', 3)
    expect(t.onDown).toHaveBeenCalledTimes(1)
    expect(t.onUp).toHaveBeenCalledTimes(1)
  })

  it('other buttons pass through untouched', () => {
    const t = setup('forward')
    const e = fire('mousedown', 0)
    expect(t.onDown).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it("'off' binds nothing", () => {
    const t = setup('off')
    fire('mousedown', 4)
    fire('mouseup', 4)
    expect(t.onDown).not.toHaveBeenCalled()
    expect(t.onUp).not.toHaveBeenCalled()
  })

  it('mouseup without a prior mousedown is a no-op', () => {
    const t = setup('forward')
    fire('mouseup', 4)
    expect(t.onUp).not.toHaveBeenCalled()
  })

  it('blur while held cancels; the late mouseup no longer fires onUp', () => {
    const t = setup('forward')
    fire('mousedown', 4)
    window.dispatchEvent(new Event('blur'))
    expect(t.onCancel).toHaveBeenCalledTimes(1)
    fire('mouseup', 4)
    expect(t.onUp).not.toHaveBeenCalled()
  })

  it('unmount removes the listeners', () => {
    const t = setup('forward')
    t.hook.unmount()
    fire('mousedown', 4)
    expect(t.onDown).not.toHaveBeenCalled()
  })

  it('trigger change mid-hold cancels the held take', () => {
    const h = { onDown: vi.fn(), onUp: vi.fn(), onCancel: vi.fn() }
    const hook = renderHook(
      ({ trigger }: { trigger: MouseTrigger }) => useMouseTrigger(trigger, h),
      { initialProps: { trigger: 'forward' as MouseTrigger } }
    )
    fire('mousedown', 4)
    hook.rerender({ trigger: 'back' })
    expect(h.onCancel).toHaveBeenCalledTimes(1)
    fire('mouseup', 3)
    expect(h.onUp).not.toHaveBeenCalled()
  })

  it('blur while not held is a no-op', () => {
    const t = setup('forward')
    window.dispatchEvent(new Event('blur'))
    expect(t.onCancel).not.toHaveBeenCalled()
  })

  it('handler identity change mid-hold routes the release to the new handlers', () => {
    const first = { onDown: vi.fn(), onUp: vi.fn(), onCancel: vi.fn() }
    const second = { onDown: vi.fn(), onUp: vi.fn(), onCancel: vi.fn() }
    const hook = renderHook(
      ({ h }: { h: typeof first }) => useMouseTrigger('forward', h),
      { initialProps: { h: first } }
    )
    fire('mousedown', 4)
    hook.rerender({ h: second })
    fire('mouseup', 4)
    expect(second.onUp).toHaveBeenCalledTimes(1)
    expect(first.onUp).not.toHaveBeenCalled()
    expect(second.onCancel).not.toHaveBeenCalled() // identity churn must NOT cancel the hold
  })
})

import { describe, it, expect, vi } from 'vitest'
import { createNotifier, type NotificationLike } from './notifications'

function fakeNotification(): NotificationLike & { clickHandlers: Array<() => void>; shown: boolean } {
  return {
    shown: false,
    clickHandlers: [],
    on(_e, cb) { this.clickHandlers.push(cb) },
    show() { this.shown = true },
  }
}

describe('createNotifier', () => {
  it('creates, wires click, and shows a notification', () => {
    const n = fakeNotification()
    const onClick = vi.fn()
    const notifier = createNotifier({ isSupported: () => true, create: () => n, onClick })
    notifier.show({ key: 't1', title: 'hi', body: 'there' })
    expect(n.shown).toBe(true)
    n.clickHandlers.forEach((cb) => cb())
    expect(onClick).toHaveBeenCalledWith('t1')
  })
  it('does nothing when notifications are unsupported', () => {
    const create = vi.fn()
    const notifier = createNotifier({ isSupported: () => false, create, onClick: vi.fn() })
    notifier.show({ key: 't1', title: 'hi', body: 'there' })
    expect(create).not.toHaveBeenCalled()
  })
  it('swallows a constructor error', () => {
    const notifier = createNotifier({
      isSupported: () => true,
      create: () => { throw new Error('boom') },
      onClick: vi.fn(),
    })
    expect(() => notifier.show({ key: 't1', title: 'x', body: 'y' })).not.toThrow()
  })
})

// The slice of an Electron Notification we use — injected so this module is
// testable without Electron (mirrors createBusyTracker / createReviewWatcher).
export interface NotificationLike {
  show(): void
  on(event: 'click', cb: () => void): void
}

export interface NotifierDeps {
  isSupported: () => boolean
  create: (opts: { title: string; body: string }) => NotificationLike
  onClick: (key: string) => void
}

export interface NotifyArgs { key: string; title: string; body: string }

export function createNotifier(deps: NotifierDeps) {
  return {
    show({ key, title, body }: NotifyArgs): void {
      if (!deps.isSupported()) return
      try {
        const n = deps.create({ title, body })
        n.on('click', () => deps.onClick(key))
        n.show()
      } catch { /* notifications are best-effort */ }
    },
  }
}

// Window-level mouse side-button listener for push-to-talk. Capture phase so
// xterm.js panes cannot swallow the button; preventDefault stops Electron's
// history navigation for the configured button only. Tracks a held flag:
// a mouseup without our mousedown (button pressed outside the window) is a
// no-op, and window blur mid-hold CANCELS — the mouseup will never arrive,
// and sending a half-finished utterance is worse than dropping it.
import { useEffect, useRef } from 'react'
import type { MouseTrigger } from '@shared/voice'

// DOM MouseEvent.button: 3 = back (X1), 4 = forward (X2).
const BUTTON: Record<Exclude<MouseTrigger, 'off'>, number> = { back: 3, forward: 4 }

export interface MouseTriggerHandlers {
  onDown: () => void
  onUp: () => void
  onCancel: () => void
}

export function useMouseTrigger(trigger: MouseTrigger, handlers: MouseTriggerHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    if (trigger === 'off') return
    const button = BUTTON[trigger]
    let held = false
    const down = (e: MouseEvent) => {
      if (e.button !== button) return
      e.preventDefault()
      e.stopPropagation()
      held = true
      ref.current.onDown()
    }
    const up = (e: MouseEvent) => {
      if (e.button !== button) return
      e.preventDefault()
      e.stopPropagation()
      if (!held) return
      held = false
      ref.current.onUp()
    }
    const blur = () => {
      if (!held) return
      held = false
      ref.current.onCancel()
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('mouseup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('mouseup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [trigger])
}

// src/renderer/src/components/termKeys.ts
// Pure classification of xterm custom key events. xterm calls the custom key
// event handler for keydown, keypress AND keyup — and an intercepted keydown
// does NOT preventDefault, so the browser still fires the Enter keypress.
// If that keypress reaches xterm's legacy keypress path it emits '\r' (submit)
// right after our '\n' — which is exactly the "Shift+Enter sometimes sends the
// prompt" bug. So Shift+Enter must be swallowed for ALL event types, and acted
// on (newline) only on keydown.

export interface TermKeyEvent {
  type: string
  code: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

export type TermKeyAction = 'newline' | 'copy' | 'paste' | 'swallow' | 'pass'

export function classifyKeyEvent(e: TermKeyEvent): TermKeyAction {
  const shiftEnter = e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey &&
    (e.code === 'Enter' || e.code === 'NumpadEnter')

  if (e.type !== 'keydown') return shiftEnter ? 'swallow' : 'pass'

  // Shift+Enter → insert a newline (LF) instead of submitting (CR).
  // Plain Enter still sends CR ("submit"); claude/codex and most readline/Ink
  // TUIs treat a bare LF (same as Ctrl+J) as "insert newline".
  if (shiftEnter) return 'newline'

  // Ctrl+Shift+C / Ctrl+Shift+V copy-paste
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') return 'copy'
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') return 'paste'

  return 'pass'
}

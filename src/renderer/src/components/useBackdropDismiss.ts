import { useRef } from 'react'
import type { MouseEvent } from 'react'

// Dismiss on a backdrop click — but only when the press also STARTED on the
// backdrop. A text selection that begins inside the dialog and releases over
// the backdrop synthesizes a click on the backdrop (the common ancestor of the
// mousedown/mouseup targets) and must not dismiss the dialog.
export function useBackdropDismiss(onDismiss: () => void): {
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void
  onClick: (e: MouseEvent<HTMLDivElement>) => void
} {
  const pressedOnBackdrop = useRef(false)
  return {
    onMouseDown: (e) => { pressedOnBackdrop.current = e.target === e.currentTarget },
    onClick: (e) => { if (pressedOnBackdrop.current && e.target === e.currentTarget) onDismiss() }
  }
}

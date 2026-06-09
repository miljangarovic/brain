// Map of terminal id → a function returning that terminal's recent output tail.
// TerminalView registers a reader over its live xterm buffer on mount; the
// attention hook reads it when the terminal goes idle. Decouples the hook from
// xterm instances without buffering output a second time in the main process.
const readers = new Map<string, () => string>()

export function registerTail(id: string, read: () => string): void { readers.set(id, read) }
export function unregisterTail(id: string): void { readers.delete(id) }

export function readTail(id: string): string {
  const r = readers.get(id)
  if (!r) return ''
  try { return r() } catch { return '' }
}

// The minimal slice of xterm's API readXtermTail depends on (keeps it testable).
export interface TermLike {
  buffer: { active: {
    baseY: number
    cursorY: number
    length: number
    getLine(i: number): { translateToString(trimRight?: boolean): string } | undefined
  } }
}

// Last `lines` buffer rows ending at the cursor row, joined as plain text.
export function readXtermTail(term: TermLike, lines: number): string {
  const buf = term.buffer.active
  const end = buf.baseY + buf.cursorY
  const start = Math.max(0, end - lines + 1)
  const out: string[] = []
  for (let i = start; i <= end; i++) {
    const ln = buf.getLine(i)
    if (ln) out.push(ln.translateToString(true))
  }
  return out.join('\n')
}

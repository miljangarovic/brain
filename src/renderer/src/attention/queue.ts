// src/renderer/src/attention/queue.ts
import type { AttentionState } from './detect'

export interface AttentionItem {
  terminalId: string
  state: AttentionState
  lastLine: string
  ts: number
}

// Insert or replace the item for a terminal, keeping the list newest-first.
export function upsertItem(queue: AttentionItem[], item: AttentionItem): AttentionItem[] {
  const rest = queue.filter((q) => q.terminalId !== item.terminalId)
  return [item, ...rest].sort((a, b) => b.ts - a.ts)
}

export function removeItem(queue: AttentionItem[], terminalId: string): AttentionItem[] {
  return queue.filter((q) => q.terminalId !== terminalId)
}

// The last non-empty line of an output tail — the queue/notification snippet.
export function lastLineOf(tail: string): string {
  const lines = tail.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

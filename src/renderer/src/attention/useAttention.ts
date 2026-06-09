// src/renderer/src/attention/useAttention.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState } from '../store'
import { getTerminalById, allTerminals, isUnderReview, showTerminal } from '../store'
import { readTail } from './tailRegistry'
import { isTouched } from './touched'
import { classifyIdle, type AttentionState } from './detect'
import { decideOnIdle, decideOnExit } from './decide'
import { upsertItem, removeItem, lastLineOf, type AttentionItem } from './queue'
import { notifTitle } from './notify'
import { beep, isMuted, setMuted } from './sound'

// Restored agents settle (resume redraw → idle) right after launch; ignore idle/
// exit events during this window so a restart doesn't fire a storm of notifications.
const STARTUP_GRACE_MS = 4000

export function useAttention(state: AppState, apply: (fn: (s: AppState) => AppState) => void) {
  const [attention, setAttentionMap] = useState<Record<string, AttentionState | undefined>>({})
  const [queue, setQueue] = useState<AttentionItem[]>([])
  const [muted, setMutedState] = useState<boolean>(() => isMuted())

  // Refs so the stable event handlers always read current values without
  // re-subscribing (which would churn ipcRenderer listeners and risk dropping
  // transitions). stateRef is refreshed every render.
  const stateRef = useRef(state)
  stateRef.current = state
  const attentionRef = useRef<Record<string, AttentionState | undefined>>({})
  const focusedRef = useRef<boolean>(typeof document !== 'undefined' ? document.hasFocus() : true)
  const startedAt = useRef<number>(Date.now())

  const [focused, setFocused] = useState<boolean>(focusedRef.current)
  useEffect(() => {
    const onFocus = () => { focusedRef.current = true; setFocused(true) }
    const onBlur = () => { focusedRef.current = false; setFocused(false) }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur) }
  }, [])

  const clearInternal = useCallback((id: string) => {
    if (attentionRef.current[id] === undefined) return
    const next = { ...attentionRef.current }; delete next[id]
    attentionRef.current = next
    setAttentionMap(next)
    setQueue((q) => removeItem(q, id))
  }, [])

  const fire = useCallback((id: string, st: AttentionState, lastLine: string) => {
    if (attentionRef.current[id] === st) return // dedup: one alert per entry into a state
    const next = { ...attentionRef.current, [id]: st }
    attentionRef.current = next
    setAttentionMap(next)
    setQueue((q) => upsertItem(q, { terminalId: id, state: st, lastLine, ts: Date.now() }))
    const t = getTerminalById(stateRef.current, id)
    window.orchestrix.showNotification({ key: id, title: notifTitle(st, t?.name ?? 'terminal'), body: lastLine })
    beep(st)
  }, [])

  const ctxFor = (id: string) => {
    const s = stateRef.current
    const t = getTerminalById(s, id)
    return {
      term: t,
      ctx: {
        isAgent: t?.kind === 'claude' || t?.kind === 'codex',
        underReview: isUnderReview(s, id),
        activeAndFocused: focusedRef.current && s.activeTerminalId === id,
      },
    }
  }

  const handleBusy = useCallback((id: string, busy: boolean) => {
    if (busy) { clearInternal(id); return } // resumed → previous attention is stale
    if (Date.now() - startedAt.current < STARTUP_GRACE_MS) return
    // Idle-derived signals fire only for terminals you've actually worked in this
    // session — a restored agent that merely settles never alerts (no spam on open).
    if (!isTouched(id)) return
    const { term, ctx } = ctxFor(id)
    if (!term) return
    const tail = readTail(id)
    const st = decideOnIdle(classifyIdle(tail), ctx)
    if (st) fire(id, st, lastLineOf(tail))
  }, [clearInternal, fire])

  const handleExit = useCallback((id: string, code: number) => {
    if (Date.now() - startedAt.current < STARTUP_GRACE_MS) return
    const { term, ctx } = ctxFor(id)
    if (!term) return
    const st = decideOnExit(code, ctx)
    if (st) fire(id, st, `exit ${code}`)
  }, [fire])

  const handleNotificationClick = useCallback((key: string) => {
    // showTerminal both un-hides (no-op when visible) and activates the terminal,
    // so a click on the alert always reveals it.
    apply((s) => showTerminal(s, key))
    clearInternal(key)
  }, [apply, clearInternal])

  const clearAll = useCallback(() => {
    for (const id of Object.keys(attentionRef.current)) clearInternal(id)
  }, [clearInternal])
  const toggleMute = useCallback(() => {
    const m = !isMuted(); setMuted(m); setMutedState(m)
  }, [])

  // Clear the attention for the terminal you're actively looking at.
  useEffect(() => {
    if (focused && state.activeTerminalId) clearInternal(state.activeTerminalId)
  }, [focused, state.activeTerminalId, clearInternal])

  // Prune entries for terminals that no longer exist (deleted/closed).
  useEffect(() => {
    const ids = new Set(allTerminals(state).map((t) => t.id))
    for (const id of Object.keys(attentionRef.current)) if (!ids.has(id)) clearInternal(id)
  }, [state.workspace, clearInternal])

  return { attention, queue, muted, handleBusy, handleExit, handleNotificationClick, clear: clearInternal, clearAll, toggleMute }
}

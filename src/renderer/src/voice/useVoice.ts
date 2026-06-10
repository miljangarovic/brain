// Wires the pure pieces (machine, executor, run) to the world (recorder,
// window.brain IPC). Owns ONE recorder at a time; the global shortcut and the
// sidebar mic button both land in toggle().
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AppState } from '../store'
import type { AgentKind } from '../agents'
import { buildSnapshot } from './snapshot'
import { planCommand } from './executor'
import { runDescriptor, type RunDeps } from './run'
import { reduceVoice, IDLE } from './machine'
import { startRecording, type RecorderHandle } from './recorder'

export interface VoiceDeps {
  state: AppState
  apply: (fn: (s: AppState) => AppState) => void
  markStarted: (id: string) => void
  stopReviewLoop: (terminalId: string) => void
  launchAgent: (featureId: string, kind: AgentKind, opts?: { prompt?: string; name?: string }) => void
}

export function useVoice(deps: VoiceDeps) {
  const [ui, dispatch] = useReducer(reduceVoice, IDLE)
  const recRef = useRef<RecorderHandle | null>(null)
  const depsRef = useRef(deps)
  depsRef.current = deps
  const uiRef = useRef(ui)
  uiRef.current = ui

  const runDeps = (): RunDeps => ({ ...depsRef.current })

  const finish = useCallback(async () => {
    const rec = recRef.current
    if (!rec) return
    recRef.current = null
    const pcm = await rec.stop()
    if (!pcm) { dispatch({ type: 'dismiss' }); return }
    window.brain.sendVoiceAudio(pcm, buildSnapshot(depsRef.current.state))
    dispatch({ type: 'audio-sent' })
  }, [])

  const toggle = useCallback(() => {
    if (recRef.current) { void finish(); return }
    // Spec: a new activation CANCELS whatever is in flight (transcription,
    // confirm modal, stale toast/error) and starts a fresh listen.
    if (uiRef.current.kind !== 'idle') {
      window.brain.cancelVoice()
      dispatch({ type: 'dismiss' })
    }
    void startRecording({ onAutoStop: () => void finish() })
      .then((rec) => { recRef.current = rec; dispatch({ type: 'listen' }) })
      .catch(() => dispatch({ type: 'mic-error', message: 'Microphone unavailable — check system permissions' }))
  }, [finish])

  const cancel = useCallback(() => {
    recRef.current?.cancel()
    recRef.current = null
    window.brain.cancelVoice()
    dispatch({ type: 'dismiss' })
  }, [])

  const confirm = useCallback((editedPrompt?: string) => {
    const s = uiRef.current
    if (s.kind !== 'confirm') return
    let d = s.descriptor
    if (d.type === 'addTerminal' && editedPrompt !== undefined) {
      const { prompt: _replaced, ...rest } = d
      d = editedPrompt.trim() ? { ...rest, prompt: editedPrompt } : rest
    }
    runDescriptor(d, runDeps())
    const toast = d.type === 'state' ? d.toast : d.type === 'closeTerminal' ? 'Terminal closed' : 'Terminal launched'
    dispatch({ type: 'executed', toast })
  }, [])

  useEffect(() => window.brain.onVoiceStart(() => toggle()), [toggle])
  useEffect(() => window.brain.onVoiceState((ev) => dispatch({ type: 'state', ev })), [])
  useEffect(() => window.brain.onVoiceResult(({ transcript, command }) => {
    // A result whose flow was canceled while it was already in transit
    // (main's gen guard could not catch it) must not execute silently.
    const k = uiRef.current.kind
    if (k !== 'processing' && k !== 'downloading') return
    const plan = planCommand(command, depsRef.current.state)
    if (plan.type === 'run') {
      runDescriptor(plan.descriptor, runDeps())
      dispatch({ type: 'executed', toast: plan.descriptor.toast })
    } else if (plan.type === 'confirm') {
      dispatch({
        type: 'confirm', transcript, summary: plan.summary, descriptor: plan.descriptor,
        ...(plan.editablePrompt !== undefined ? { editablePrompt: plan.editablePrompt } : {})
      })
    } else {
      dispatch({ type: 'plan-error', message: plan.message, transcript })
    }
  }), [])

  // Result toasts disappear on their own; errors stay until dismissed.
  useEffect(() => {
    if (ui.kind !== 'toast') return
    const t = setTimeout(() => dispatch({ type: 'dismiss' }), 4000)
    return () => clearTimeout(t)
  }, [ui])

  return { ui, toggle, cancel, confirm }
}

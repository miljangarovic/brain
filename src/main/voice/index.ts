// Voice pipeline owner (main side): global shortcut → tell the renderer to
// toggle recording; PCM arrives → model → whisper (utilityProcess) → latin
// transcript → Groq intent → result back to the renderer. A generation
// counter implements cancel: any stage that awaits checks it before
// continuing, so late results of a canceled command are dropped silently.
import { BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { promises as fsp } from 'fs'
import { IPC } from '@shared/ipc'
import type { VoiceStateEvent, VoiceUiConfig, WorkspaceSnapshot } from '@shared/voice'
import { loadVoiceConfig } from './config'
import { ensureModel } from './models'
import { encodeWavPcm16 } from './wav'
import { toLatin } from './translit'
import { parseIntent, VoiceIntentError } from './intent'
import { createTranscriber } from './transcriber'

export async function registerVoice(opts: {
  getWin: () => BrowserWindow | null
  userDataDir: string
}): Promise<{ dispose: () => void }> {
  const { getWin, userDataDir } = opts
  const config = await loadVoiceConfig(userDataDir)

  const send = (channel: string, payload: unknown) => {
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const sendState = (ev: VoiceStateEvent) => send(IPC.voiceState, ev)

  // UI-safe config subset for the renderer (never the Groq key). Registered
  // even when voice is disabled so the invoke resolves to 'off' instead of
  // rejecting — the renderer then binds no mouse listeners.
  ipcMain.handle(IPC.voiceUiConfig, (): VoiceUiConfig => ({
    mouseTrigger: config.enabled ? config.mouseTrigger : 'off',
    mouseTriggerMode: config.mouseTriggerMode
  }))

  if (!config.enabled) {
    // The sidebar mic button renders regardless of config — answer its audio
    // with a clear error instead of leaving the pill stuck on "Transcribing…".
    ipcMain.on(IPC.voiceAudio, () => sendState({ phase: 'error', message: 'Voice is disabled in voice.json' }))
    return { dispose: () => { ipcMain.removeHandler(IPC.voiceUiConfig) } }
  }

  const transcriber = createTranscriber({ childPath: join(__dirname, 'transcriberChild.js') })
  let gen = 0

  const registered = globalShortcut.register(config.shortcut, () => {
    const win = getWin()
    if (!win || win.isDestroyed()) return
    if (!win.isVisible()) win.show()
    win.focus()
    send(IPC.voiceStart, {})
  })
  if (!registered) {
    // Renderer may still be loading at startup — deliver the warning when it
    // can actually display it. The sidebar mic button remains the trigger.
    const warn = () => sendState({
      phase: 'error',
      message: `Voice shortcut "${config.shortcut}" could not be registered — use the sidebar mic button`
    })
    const win = getWin()
    if (win && win.webContents.isLoading()) win.webContents.once('did-finish-load', warn)
    else warn()
  }

  ipcMain.on(IPC.voiceAudio, (_e, p: { pcm: Float32Array; snapshot: WorkspaceSnapshot }) => {
    const my = ++gen
    const alive = () => my === gen
    void (async () => {
      let transcript: string | undefined
      try {
        const modelPath = await ensureModel(
          config.modelId, join(userDataDir, 'voice-models'), fetch,
          (received, total) => { if (alive()) sendState({ phase: 'downloading-model', received, total }) }
        )
        if (!alive()) return
        sendState({ phase: 'transcribing' })
        // Structured clone usually preserves Float32Array; coerce defensively.
        const pcm = p.pcm instanceof Float32Array ? p.pcm : new Float32Array(p.pcm as ArrayLike<number>)
        const wavPath = join(tmpdir(), `brain-voice-${process.pid}-${my}.wav`)
        await fsp.writeFile(wavPath, encodeWavPcm16(pcm, 16000))
        if (!alive()) { void fsp.rm(wavPath, { force: true }).catch(() => {}) ; return }
        let raw: string
        try {
          // NOTE: the addon has no initial-prompt option — script/vocabulary bias is handled by toLatin + the intent LLM's fuzzy matching instead.
          raw = await transcriber.transcribe({ wavPath, modelPath, language: config.language })
        } finally {
          void fsp.rm(wavPath, { force: true }).catch(() => {})
        }
        if (!alive()) return
        transcript = toLatin(raw).trim()
        if (!transcript) { sendState({ phase: 'error', message: 'Nothing was heard — try again' }); return }
        sendState({ phase: 'parsing', transcript })
        if (!config.groqApiKey) {
          sendState({ phase: 'error', message: 'Groq API key missing — set GROQ_API_KEY or add "groqApiKey" to voice.json', transcript })
          return
        }
        const command = await parseIntent({
          transcript, snapshot: p.snapshot,
          apiKey: config.groqApiKey, model: config.groqModel
        })
        if (!alive()) return
        send(IPC.voiceResult, { transcript, command })
      } catch (err) {
        if (!alive()) return
        const message = err instanceof VoiceIntentError ? err.message : `Voice command failed: ${err instanceof Error ? err.message : String(err)}`
        sendState({ phase: 'error', message, ...(transcript ? { transcript } : {}) })
      }
    })()
  })

  ipcMain.on(IPC.voiceCancel, () => { gen++ })

  return {
    dispose: () => {
      globalShortcut.unregister(config.shortcut)
      ipcMain.removeHandler(IPC.voiceUiConfig)
      transcriber.dispose()
    }
  }
}

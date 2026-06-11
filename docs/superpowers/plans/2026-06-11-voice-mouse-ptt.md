# Voice Mouse Side-Button Push-to-Talk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold a configurable mouse side button (default: forward/X2) while the app is focused to record a voice command; release to send it through the existing whisper → Groq → executor pipeline.

**Architecture:** A new `mouseTrigger` field in `voice.json` travels to the renderer over a new invoke channel exposing only the UI-safe config subset. The renderer gets a `useMouseTrigger` hook (capture-phase window listeners, held-state tracking, blur-cancels) wired to two new `useVoice` exports — `pressStart()`/`pressEnd()` — which drive the existing recorder with VAD auto-stop disabled (`vadAutoStop: false`): while the button is held, a pause in speech must not end the take.

**Tech Stack:** Existing voice modules (TypeScript, vitest + jsdom + @testing-library/react), Electron `ipcMain.handle`/`ipcRenderer.invoke`.

**Spec:** `docs/superpowers/specs/2026-06-11-voice-mouse-ptt-design.md`

**File map:**
- Modify: `src/shared/voice.ts` (+`MouseTrigger`, `VoiceUiConfig` types)
- Modify: `src/main/voice/config.ts` (+`mouseTrigger` field), `src/main/voice/config.test.ts` (+2 tests)
- Modify: `src/shared/ipc.ts` (+1 channel), `src/shared/api.ts` (+1 method), `src/preload/index.ts` (+1 method), `src/main/voice/index.ts` (+handler)
- Modify: `src/renderer/src/voice/recorder.ts` (+`vadAutoStop` option); Create: `src/renderer/src/voice/recorder.test.ts`
- Modify: `src/renderer/src/voice/useVoice.ts` (+`pressStart`/`pressEnd`); Create: `src/renderer/src/voice/useVoice.test.tsx`
- Create: `src/renderer/src/voice/useMouseTrigger.ts` + `src/renderer/src/voice/useMouseTrigger.test.tsx`
- Modify: `src/renderer/src/App.tsx` (config fetch + hook wiring)

---

### Task 1: Config — `mouseTrigger` field + shared types

**Files:**
- Modify: `src/shared/voice.ts`
- Modify: `src/main/voice/config.ts`
- Test: `src/main/voice/config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/voice/config.test.ts`, add inside `describe('parseVoiceConfig', ...)`:

```ts
  it('accepts mouseTrigger literals', () => {
    expect(parseVoiceConfig({ mouseTrigger: 'back' }).mouseTrigger).toBe('back')
    expect(parseVoiceConfig({ mouseTrigger: 'off' }).mouseTrigger).toBe('off')
    expect(parseVoiceConfig({ mouseTrigger: 'forward' }).mouseTrigger).toBe('forward')
  })
  it('falls back to forward for invalid mouseTrigger', () => {
    expect(parseVoiceConfig({ mouseTrigger: 'middle' }).mouseTrigger).toBe('forward')
    expect(parseVoiceConfig({ mouseTrigger: 7 }).mouseTrigger).toBe('forward')
    expect(parseVoiceConfig({}).mouseTrigger).toBe('forward')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/voice/config.test.ts`
Expected: FAIL — `mouseTrigger` is `undefined` (field does not exist yet). The existing `'ignores wrong-typed fields'` test keeps passing (it uses `toEqual(DEFAULT_VOICE_CONFIG)`, which will gain the field in the same change).

- [ ] **Step 3: Implement**

In `src/shared/voice.ts`, append at the end of the file:

```ts
// Mouse side-button push-to-talk trigger; the UI-safe config subset the
// renderer is allowed to see (never the Groq key).
export type MouseTrigger = 'forward' | 'back' | 'off'
export interface VoiceUiConfig { mouseTrigger: MouseTrigger }
```

In `src/main/voice/config.ts`:

```ts
import type { MouseTrigger } from '../../shared/voice'
```

Add to the `VoiceConfig` interface:

```ts
  mouseTrigger: MouseTrigger
```

Add to `DEFAULT_VOICE_CONFIG`:

```ts
  mouseTrigger: 'forward'
```

Add to `parseVoiceConfig` (next to the other field guards):

```ts
  if (o.mouseTrigger === 'forward' || o.mouseTrigger === 'back' || o.mouseTrigger === 'off') c.mouseTrigger = o.mouseTrigger
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/voice/config.test.ts`
Expected: PASS (all, including the pre-existing three).

- [ ] **Step 5: Commit**

```bash
git add src/shared/voice.ts src/main/voice/config.ts src/main/voice/config.test.ts
git commit -m "feat(voice): mouseTrigger config field + UI-safe config types"
```

---

### Task 2: IPC plumbing — channel, main handler, BrainApi, preload

Electron wiring (`ipcMain.handle` in `registerVoice`, preload bridge) follows the repo's existing pattern of not unit-testing main-process IPC registration (`registerVoice` itself has no test); verification here is typecheck + full suite + the behavioral tests in Tasks 4–6 that consume the bridge.

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/voice/index.ts`

- [ ] **Step 1: Add the channel**

In `src/shared/ipc.ts`, extend the voice block:

```ts
  voiceCancel: 'voice:cancel',
  voiceUiConfig: 'voice:ui-config'
```

- [ ] **Step 2: Add the API signature**

In `src/shared/api.ts`, extend the voice import:

```ts
import type { VoiceResult, VoiceStateEvent, VoiceUiConfig, WorkspaceSnapshot } from './voice'
```

and add after `cancelVoice(): void`:

```ts
  getVoiceUiConfig(): Promise<VoiceUiConfig>
```

- [ ] **Step 3: Implement the preload bridge**

In `src/preload/index.ts`, extend the voice type import:

```ts
import type { VoiceResult, VoiceStateEvent, VoiceUiConfig, WorkspaceSnapshot } from '../shared/voice'
```

and add to the `api` object after `cancelVoice`:

```ts
  cancelVoice: () => ipcRenderer.send(IPC.voiceCancel),
  getVoiceUiConfig: () => ipcRenderer.invoke(IPC.voiceUiConfig) as Promise<VoiceUiConfig>
```

- [ ] **Step 4: Implement the main handler**

In `src/main/voice/index.ts`, insert between `const sendState = ...` and the `if (!config.enabled)` block:

```ts
  // UI-safe config subset for the renderer (never the Groq key). Registered
  // even when voice is disabled so the invoke resolves to 'off' instead of
  // rejecting — the renderer then binds no mouse listeners.
  ipcMain.handle(IPC.voiceUiConfig, () => ({
    mouseTrigger: config.enabled ? config.mouseTrigger : 'off'
  }))
```

Update the disabled branch's return to clean the handler up:

```ts
    return { dispose: () => { ipcMain.removeHandler(IPC.voiceUiConfig) } }
```

and add the same line to the main `dispose`:

```ts
    dispose: () => {
      globalShortcut.unregister(config.shortcut)
      ipcMain.removeHandler(IPC.voiceUiConfig)
      transcriber.dispose()
    }
```

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/voice/index.ts
git commit -m "feat(voice): voice:ui-config invoke channel exposes mouseTrigger to renderer"
```

---

### Task 3: Recorder — `vadAutoStop` option

**Files:**
- Modify: `src/renderer/src/voice/recorder.ts`
- Create: `src/renderer/src/voice/recorder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/voice/recorder.test.ts`. jsdom has no Web Audio — fake the minimal surface the recorder touches; the `AudioWorkletNode` fake exposes its `port` so tests drive PCM chunks in directly. `FakeAudioContext.sampleRate` is 16000, so `downsample` is an identity and sample counts map 1:1 to seconds.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startRecording } from './recorder'

class FakeWorkletNode {
  port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null }
  connect = vi.fn()
  disconnect = vi.fn()
  constructor() { lastNode = this }
}
let lastNode: FakeWorkletNode | null = null

class FakeAudioContext {
  sampleRate = 16000
  audioWorklet = { addModule: vi.fn(async () => {}) }
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
  close = vi.fn(async () => {})
}

const track = { stop: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  lastNode = null
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) }
  })
  URL.createObjectURL = vi.fn(() => 'blob:voice-capture')
  URL.revokeObjectURL = vi.fn()
})

// 1 s of speech / silence at the fake 16 kHz rate.
const loud = () => new Float32Array(16000).fill(0.5)
const silent = () => new Float32Array(16000)
const push = (c: Float32Array) => lastNode!.port.onmessage!({ data: c })

describe('startRecording VAD gating', () => {
  it('auto-stops on silence after speech by default', async () => {
    const onAutoStop = vi.fn()
    await startRecording({ onAutoStop })
    push(loud())               // 1 s speech ≥ minSpeechMs 250
    push(silent())
    push(silent())             // 2 s silence ≥ holdMs 1200
    expect(onAutoStop).toHaveBeenCalledTimes(1)
  })

  it('vadAutoStop: false never fires onAutoStop, audio still accumulates', async () => {
    const onAutoStop = vi.fn()
    const rec = await startRecording({ onAutoStop, vadAutoStop: false })
    push(loud())
    push(silent())
    push(silent())
    expect(onAutoStop).not.toHaveBeenCalled()
    const pcm = await rec.stop()
    expect(pcm).toHaveLength(48000)          // all 3 s kept
  })

  it('keeps the sub-0.4 s misfire guard regardless of mode', async () => {
    const rec = await startRecording({ onAutoStop: vi.fn(), vadAutoStop: false })
    push(new Float32Array(1600))             // 0.1 s
    expect(await rec.stop()).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/voice/recorder.test.ts`
Expected: test 1 PASSES (current behavior), test 2 FAILS (`onAutoStop` fires — option ignored), test 3 passes. The failing middle test is the new behavior.

- [ ] **Step 3: Implement**

In `src/renderer/src/voice/recorder.ts`, change the signature:

```ts
export async function startRecording(opts: { onAutoStop: () => void; vadAutoStop?: boolean }): Promise<RecorderHandle> {
```

add next to the tracker setup (after `const tracker = ...`):

```ts
    // Push-to-talk holds the button deliberately — a pause in speech must
    // not end the take, so PTT passes vadAutoStop: false.
    const vad = opts.vadAutoStop !== false
```

and gate the auto-stop branch in `node.port.onmessage`:

```ts
      if (vad && !autoStopFired && tracker.push(e.data) === 'stop') {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/voice/recorder.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/recorder.ts src/renderer/src/voice/recorder.test.ts
git commit -m "feat(voice): recorder vadAutoStop option for push-to-talk takes"
```

---

### Task 4: `useVoice` — `pressStart()` / `pressEnd()`

**Files:**
- Modify: `src/renderer/src/voice/useVoice.ts`
- Create: `src/renderer/src/voice/useVoice.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/voice/useVoice.test.tsx` (window.brain established before the hook import, same pattern as `review/useReview.test.tsx`; recorder mocked at module level):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AppState } from '../store'
import type { RecorderHandle } from './recorder'

const startRecording = vi.fn<(opts: unknown) => Promise<RecorderHandle>>()
vi.mock('./recorder', () => ({
  startRecording: (opts: unknown) => startRecording(opts)
}))

const brain = {
  sendVoiceAudio: vi.fn(),
  cancelVoice: vi.fn(),
  onVoiceStart: vi.fn(() => () => {}),
  onVoiceState: vi.fn(() => () => {}),
  onVoiceResult: vi.fn(() => () => {})
}
beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { brain: typeof brain }).brain = brain
})

// Import after the window.brain shape is established.
import { useVoice } from './useVoice'

const mkState = (): AppState => ({
  workspace: {
    groups: [{
      id: 'g', name: 'G', cwd: '/p', collapsed: false,
      features: [{
        id: 'f', name: 'F', collapsed: false,
        terminals: [{ id: 't', name: 'claude', cwd: '/p', kind: 'claude' }]
      }]
    }]
  },
  activeGroupId: 'g', activeFeatureId: 'f', activeTerminalId: 't', hidden: []
})

const mkRec = (): RecorderHandle => ({
  stop: vi.fn(async () => new Float32Array(16000)),   // a healthy 1 s take
  cancel: vi.fn()
})

function setup() {
  return renderHook(() => useVoice({
    state: mkState(),
    apply: vi.fn(),
    markStarted: vi.fn(),
    stopReviewLoop: vi.fn(),
    launchAgent: vi.fn(),
    liveAgents: {},
    sendPrompt: vi.fn()
  }))
}

describe('push-to-talk', () => {
  it('pressStart records with VAD auto-stop disabled', async () => {
    startRecording.mockResolvedValue(mkRec())
    const h = setup()
    await act(async () => { h.result.current.pressStart() })
    expect(startRecording).toHaveBeenCalledWith(expect.objectContaining({ vadAutoStop: false }))
    expect(h.result.current.ui.kind).toBe('listening')
  })

  it('pressEnd finishes the take and ships the audio', async () => {
    const rec = mkRec()
    startRecording.mockResolvedValue(rec)
    const h = setup()
    await act(async () => { h.result.current.pressStart() })
    await act(async () => { h.result.current.pressEnd() })
    expect(rec.stop).toHaveBeenCalled()
    expect(brain.sendVoiceAudio).toHaveBeenCalled()
    expect(h.result.current.ui.kind).toBe('processing')
  })

  it('pressEnd while idle is a no-op', async () => {
    const h = setup()
    await act(async () => { h.result.current.pressEnd() })
    expect(startRecording).not.toHaveBeenCalled()
    expect(brain.sendVoiceAudio).not.toHaveBeenCalled()
    expect(h.result.current.ui.kind).toBe('idle')
  })

  it('release before the mic resolves still ends the take', async () => {
    let resolveRec!: (r: RecorderHandle) => void
    startRecording.mockReturnValue(new Promise<RecorderHandle>((r) => { resolveRec = r }))
    const rec = mkRec()
    ;(rec.stop as ReturnType<typeof vi.fn>).mockResolvedValue(null)   // sub-0.4 s click
    const h = setup()
    await act(async () => { h.result.current.pressStart() })
    await act(async () => { h.result.current.pressEnd() })            // button already up
    await act(async () => { resolveRec(rec) })
    expect(rec.stop).toHaveBeenCalled()
    expect(h.result.current.ui.kind).toBe('idle')                     // null pcm → silent dismiss
  })

  it('pressStart cancels an in-flight recording and starts fresh', async () => {
    const first = mkRec()
    const second = mkRec()
    startRecording.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const h = setup()
    await act(async () => { h.result.current.pressStart() })
    await act(async () => { h.result.current.pressStart() })
    expect(first.cancel).toHaveBeenCalled()
    expect(brain.cancelVoice).toHaveBeenCalled()
    expect(startRecording).toHaveBeenCalledTimes(2)
    expect(h.result.current.ui.kind).toBe('listening')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/voice/useVoice.test.tsx`
Expected: FAIL to compile/run — `pressStart`/`pressEnd` do not exist on the hook's return value.

- [ ] **Step 3: Implement**

In `src/renderer/src/voice/useVoice.ts`:

Add a ref next to the existing ones (after `cancelEpochRef`):

```ts
  const releasedRef = useRef(false)
```

Add after the `cancel` callback (it reuses `cancel` and `finish`):

```ts
  // Push-to-talk: hold a mouse side button to record, release to send.
  // VAD auto-stop is disabled — the button delimits the take.
  const pressStart = useCallback(() => {
    if (startingRef.current) return
    // A PTT press is a new activation: cancel anything in flight (an active
    // shortcut-initiated recording, transcription, confirm overlay).
    if (recRef.current || uiRef.current.kind !== 'idle') cancel()
    releasedRef.current = false
    startingRef.current = true
    void startRecording({ onAutoStop: () => void finish(), vadAutoStop: false })
      .then((rec) => {
        recRef.current = rec
        startingRef.current = false
        dispatch({ type: 'listen' })
        // The button can come back up before getUserMedia resolves — that
        // release must still end the take or it would record forever.
        if (releasedRef.current) void finish()
      })
      .catch(() => { startingRef.current = false; dispatch({ type: 'mic-error', message: 'Microphone unavailable — check system permissions' }) })
  }, [cancel, finish])

  const pressEnd = useCallback(() => {
    releasedRef.current = true
    if (recRef.current) void finish()
  }, [finish])
```

Extend the return:

```ts
  return { ui, toggle, cancel, confirm, pressStart, pressEnd }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/voice/useVoice.test.tsx`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/useVoice.ts src/renderer/src/voice/useVoice.test.tsx
git commit -m "feat(voice): pressStart/pressEnd push-to-talk pair on useVoice"
```

---

### Task 5: `useMouseTrigger` hook

**Files:**
- Create: `src/renderer/src/voice/useMouseTrigger.ts`
- Create: `src/renderer/src/voice/useMouseTrigger.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/voice/useMouseTrigger.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { MouseTrigger } from '@shared/voice'
import { useMouseTrigger } from './useMouseTrigger'

const fire = (type: 'mousedown' | 'mouseup', button: number) => {
  const e = new MouseEvent(type, { button, cancelable: true })
  window.dispatchEvent(e)
  return e
}

function setup(trigger: MouseTrigger) {
  const h = { onDown: vi.fn(), onUp: vi.fn(), onCancel: vi.fn() }
  const hook = renderHook(() => useMouseTrigger(trigger, h))
  return { ...h, hook }
}

describe('useMouseTrigger', () => {
  it('forward → button 4 down/up cycle, default behavior suppressed', () => {
    const t = setup('forward')
    const down = fire('mousedown', 4)
    expect(t.onDown).toHaveBeenCalledTimes(1)
    expect(down.defaultPrevented).toBe(true)
    const up = fire('mouseup', 4)
    expect(t.onUp).toHaveBeenCalledTimes(1)
    expect(up.defaultPrevented).toBe(true)
    expect(t.onCancel).not.toHaveBeenCalled()
  })

  it('back → button 3', () => {
    const t = setup('back')
    fire('mousedown', 3)
    fire('mouseup', 3)
    expect(t.onDown).toHaveBeenCalledTimes(1)
    expect(t.onUp).toHaveBeenCalledTimes(1)
  })

  it('other buttons pass through untouched', () => {
    const t = setup('forward')
    const e = fire('mousedown', 0)
    expect(t.onDown).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it("'off' binds nothing", () => {
    const t = setup('off')
    fire('mousedown', 4)
    fire('mouseup', 4)
    expect(t.onDown).not.toHaveBeenCalled()
    expect(t.onUp).not.toHaveBeenCalled()
  })

  it('mouseup without a prior mousedown is a no-op', () => {
    const t = setup('forward')
    fire('mouseup', 4)
    expect(t.onUp).not.toHaveBeenCalled()
  })

  it('blur while held cancels; the late mouseup no longer fires onUp', () => {
    const t = setup('forward')
    fire('mousedown', 4)
    window.dispatchEvent(new Event('blur'))
    expect(t.onCancel).toHaveBeenCalledTimes(1)
    fire('mouseup', 4)
    expect(t.onUp).not.toHaveBeenCalled()
  })

  it('unmount removes the listeners', () => {
    const t = setup('forward')
    t.hook.unmount()
    fire('mousedown', 4)
    expect(t.onDown).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/voice/useMouseTrigger.test.tsx`
Expected: FAIL — module `./useMouseTrigger` does not exist.

- [ ] **Step 3: Implement**

Create `src/renderer/src/voice/useMouseTrigger.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/voice/useMouseTrigger.test.tsx`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/useMouseTrigger.ts src/renderer/src/voice/useMouseTrigger.test.tsx
git commit -m "feat(voice): useMouseTrigger capture-phase side-button hook"
```

---

### Task 6: App wiring + verification

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Wire the hook**

In `src/renderer/src/App.tsx`, add the imports (next to the existing `useVoice` import):

```tsx
import { useMouseTrigger } from './voice/useMouseTrigger'
import type { MouseTrigger } from '@shared/voice'
```

Add state near the other `useState` declarations — `'off'` until the config resolves, so no listeners bind prematurely:

```tsx
  const [mouseTrigger, setMouseTrigger] = useState<MouseTrigger>('off')
  useEffect(() => {
    void window.brain.getVoiceUiConfig().then((c) => setMouseTrigger(c.mouseTrigger))
  }, [])
```

Immediately after the `const voice = useVoice({ ... })` call:

```tsx
  useMouseTrigger(mouseTrigger, { onDown: voice.pressStart, onUp: voice.pressEnd, onCancel: voice.cancel })
```

- [ ] **Step 2: Typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: both clean.

- [ ] **Step 3: Manual verification (`npm run dev`)**

- Hold forward button → pill shows Listening; speak; release → command processed.
- Pause >1.2 s mid-hold while speaking → recording does NOT end early.
- Quick accidental click → nothing visible (silent dismiss, no error toast).
- Hold + alt-tab away → recording cancelled, no command fires.
- Hold while focus is inside an xterm pane → still records (capture phase).
- Forward/back buttons never trigger history navigation.
- `voice.json` with `"mouseTrigger": "back"` → back button drives PTT; `"off"` → side buttons inert.
- `Ctrl+Alt+Space` and the sidebar mic button still behave exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(voice): wire mouse side-button push-to-talk into App"
```

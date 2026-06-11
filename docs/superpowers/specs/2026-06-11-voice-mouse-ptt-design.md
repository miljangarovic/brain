# Voice Activation: Mouse Side-Button Push-to-Talk — Design

**Date:** 2026-06-11
**Status:** Approved
**Extends:** `2026-06-10-voice-commands-design.md` (activation section)

## Goal

A third activation path for voice commands: hold a mouse side button
(default: forward/X2) to record, release to send. Push-to-talk — the button
press delimits the utterance, so the user controls exactly when recording
starts and ends. Works only while the app window is focused; complements,
not replaces, the global shortcut and the sidebar mic button.

## Scope

- **In-window only.** Global (unfocused) mouse capture would need a native
  hook (uiohook/evdev) — explicitly out of scope.
- **One button, push-to-talk:** mousedown = start recording, mouseup =
  finish and send into the existing pipeline (whisper → Groq → executor).
- **Configurable:** `voice.json` gains `"mouseTrigger": "forward" | "back"
  | "off"`, default `"forward"`. Invalid values fall back to the default.
- Existing triggers (`Ctrl+Alt+Space`, sidebar mic button) unchanged,
  active in parallel.

## Decisions

- **PTT with explicit start/stop, not two `toggle()` calls:** if VAD
  auto-stop fired mid-hold (a 1.2 s pause in speech), the mouseup would
  START a new recording instead of ending the old one. PTT therefore gets
  its own `pressStart()`/`pressEnd()` pair in `useVoice`.
- **VAD auto-stop disabled for PTT recordings:** while the button is held,
  a pause in speech must not end the take. The recorder gains a
  `vadAutoStop` option (default `true`); shortcut/mic-button flows keep
  today's behavior. The 0.4 s minimum-length guard in `stop()` stays for
  all flows — an accidental click yields `null` PCM and a silent dismiss.
- **Config reaches the renderer via a new invoke channel** returning only
  the UI-safe subset (`{ mouseTrigger }`). `voice.json` is read in main
  only; the Groq key must never cross into the renderer (unchanged
  invariant from v1).
- **Capture-phase window listeners:** xterm.js consumes mouse events inside
  terminal panes; listening on `window` in the capture phase sees the side
  button everywhere. `preventDefault()` suppresses Electron's history
  navigation for the configured button only.
- **`pressStart` is a new activation:** like the shortcut, it cancels
  whatever is in flight (active recording, transcription, confirm overlay,
  stale toast) and starts a fresh listen — inherited semantics.
- **Window blur mid-hold cancels:** alt-tab while holding means the mouseup
  never arrives. The trigger hook tracks the held state and cancels (never
  sends) on blur — sending a half-finished utterance is worse than
  dropping it.

## Changes by module

| Module | Change |
|---|---|
| `src/shared/voice.ts` | `MouseTrigger = 'forward' \| 'back' \| 'off'` + `VoiceUiConfig = { mouseTrigger: MouseTrigger }` types |
| `src/shared/ipc.ts` | `voiceUiConfig: 'voice:ui-config'` |
| `src/main/voice/config.ts` | `mouseTrigger: MouseTrigger` field on `VoiceConfig`, default `'forward'`; `parseVoiceConfig` accepts only the three literals, anything else → default |
| `src/main/voice/index.ts` | `ipcMain.handle(IPC.voiceUiConfig)` → `{ mouseTrigger }`, registered BEFORE the `enabled` early-return; when voice is disabled it returns `{ mouseTrigger: 'off' }` so the renderer binds no listeners; `dispose()` also `removeHandler`s |
| `src/preload/index.ts` | `getVoiceUiConfig(): Promise<VoiceUiConfig>` via `ipcRenderer.invoke` |
| `src/renderer/src/voice/recorder.ts` | `startRecording(opts: { onAutoStop; vadAutoStop?: boolean })` — when `false`, the SilenceTracker result never fires `onAutoStop`; min-length guard in `stop()` unchanged |
| `src/renderer/src/voice/useVoice.ts` | new exports `pressStart()` (cancel in-flight incl. active recording → `startRecording({ vadAutoStop: false })`) and `pressEnd()` (`finish()` if recording, else no-op) |
| `src/renderer/src/voice/useMouseTrigger.ts` (NEW) | `useMouseTrigger(trigger, { onDown, onUp, onCancel })` — capture-phase `mousedown`/`mouseup` on `window`, DOM button map `back → 3`, `forward → 4`, `preventDefault` + `stopPropagation` for the configured button only; tracks a `held` ref: down → `onDown`, up while held → `onUp`, `blur` while held → `onCancel`; `'off'` → no listeners |
| `src/renderer/src/App.tsx` | fetch `getVoiceUiConfig()` on mount (state, `'off'` until resolved); `useMouseTrigger(cfg.mouseTrigger, { onDown: pressStart, onUp: pressEnd, onCancel: cancel })` |

## Edge cases

- **Click shorter than 0.4 s** → existing recorder guard returns `null`,
  UI dismisses silently. No error toast for an accidental click.
- **mouseup without prior mousedown** (button pressed outside the window,
  released inside) → `held` is false → no-op.
- **mousedown while shortcut-initiated recording is active** → cancel +
  fresh PTT listen (new-activation semantics).
- **Mic permission error on pressStart** → existing `mic-error` state;
  the following mouseup finds no recording and no-ops.
- **Voice disabled / config fetch pending** → `mouseTrigger` is `'off'`,
  no listeners bound, side buttons keep their default behavior.

## Testing

- `config.test.ts`: `mouseTrigger` valid literals / invalid value /
  missing → default `'forward'`.
- `useMouseTrigger.test.ts(x)`: button mapping (3/4), `'off'` binds
  nothing, `preventDefault` called only for configured button, up-without-
  down no-op, blur-while-held fires `onCancel` not `onUp`.
- `useVoice.test.ts(x)`: `pressStart` passes `vadAutoStop: false` and
  cancels in-flight state; `pressEnd` finishes an active recording;
  `pressEnd` in idle is a no-op.
- `recorder.test.ts`: `vadAutoStop: false` → silence never fires
  `onAutoStop`; default `true` keeps current behavior.
- Manual: hold-speak-release sends; pause mid-hold does not send early;
  accidental click is silent; alt-tab mid-hold cancels; xterm pane focus
  does not swallow the button; back/forward never navigate.

# Voice Commands — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Control the app by voice, in Serbian with embedded English technical terms
("dodaj claude terminal u file panes sa promptom ..."). A global shortcut starts
listening; speech is transcribed locally, parsed into a structured command by a
cloud LLM, and executed against the existing store actions. Safe commands run
immediately; commands that create or destroy something show a confirmation
overlay first.

## Scope

v1 commands, all mapping to existing store actions:

- **Navigation:** switch to a feature (across groups), toggle a feature's
  tabs/grid view, switch to a terminal tab.
- **New terminal with prompt:** add a claude/codex/shell terminal to a feature,
  with an optional spoken prompt passed at launch.
- **Terminal management:** hide/close a terminal, rename a feature/terminal,
  set a feature's grid style.

Out of scope for v1: wake word ("hej terminaltor"), creating features/groups,
sending a prompt into an already-running agent session, any local intent
fallback when Groq is unreachable, non-Linux platform testing.

## Decisions (and why)

- **STT runs locally** via whisper.cpp — free forever, offline, audio never
  leaves the machine. Serbian quality comes from community fine-tunes (below),
  not vanilla Whisper (zero-shot Serbian WER is unusable below large).
- **Intent parsing uses the Groq free-tier LLM** (OpenAI-compatible REST,
  JSON mode) — robust against Serbian inflection and mixed-language phrasing,
  ~0.3 s latency, free. Only the transcript and workspace names go to the
  cloud, never audio.
- **Activation is a global system shortcut** (works even when the app is not
  focused; pressing it raises the window). The user's session is X11, where
  Electron `globalShortcut` is reliable; a sidebar mic button is the backup
  trigger if registration ever fails (e.g. a future Wayland move).
- **Hybrid confirmation:** navigation and reversible actions execute
  immediately with a toast; creating/destructive actions (new terminal with
  prompt, close terminal) show a confirm overlay with an editable prompt
  field. Renames also confirm — not because they are destructive, but because
  the new name is free-form text, the payload most likely to be silently
  garbled by STT.
- **Main process owns the pipeline** (approach A): the renderer only records
  audio and renders UI; whisper and the Groq call live in main. The Groq API
  key never enters the renderer, and the split matches the existing
  architecture (main = resources/network, renderer = state/UI).

## Architecture & data flow

```
globalShortcut (main)            sidebar mic button (renderer)
        │                                  │
        ├── focus window ──────────────────┤
        ▼                                  ▼
main → renderer: voice:start  ──► recorder: getUserMedia → AudioWorklet
                                  → 16 kHz mono Float32 PCM (accumulated)
                                  stop on: 2nd shortcut press | ~1.2 s of
                                  silence (RMS) | Esc (cancel)
renderer → main: voice:audio { pcm, snapshot }
main: transcriber (utilityProcess, whisper.cpp) → transcript
main: cyrillic→latin transliteration (deterministic char map, nj/lj/dž aware)
main: intent (Groq, JSON mode: transcript + snapshot + schema) → VoiceCommand
main → renderer: voice:result { transcript, command }
renderer: executor validates ids against LIVE state
        ├── safe + high confidence ──► apply(action) + toast
        └── needs confirm | low confidence | unknown ──► VoiceOverlay confirm
                                   (Enter = execute, Esc = cancel,
                                    prompt editable in a textarea)
```

`voice:state` events (listening / transcribing / parsing / downloading-model
progress / error) drive the overlay throughout. Electron `globalShortcut` has
no key-up event, so push-and-hold is impossible — hence toggle + silence
auto-stop.

## Command schema

The Groq response is forced to this JSON shape (validated in main before it is
forwarded; anything malformed becomes `unknown`):

```ts
export type VoiceAction =
  | 'switch_feature'   // → setActiveFeature(featureId)
  | 'toggle_grid'      // → toggleFeatureViewMode(featureId ?? active)
  | 'switch_tab'       // → setActiveTerminal(terminalId)
  | 'set_grid_style'   // → setFeatureGridStyle(featureId ?? active, gridStyle)
  | 'hide_terminal'    // → hideTerminal(terminalId ?? active)
  | 'add_terminal'     // → quick-launch path (extracted launchAgent), featureId ?? active
  | 'close_terminal'   // → same branch as App's onDeleteTerminal:
                       //   reviewer → review.stopLoop(id), else removeTerminal(id)
  | 'rename_feature'   // → renameFeature(featureId, name)
  | 'rename_terminal'  // → renameTerminal(terminalId, name)
  | 'unknown'

export interface VoiceCommand {
  action: VoiceAction
  featureId?: string
  terminalId?: string
  kind?: 'claude' | 'codex' | 'shell'
  prompt?: string          // spoken prompt for add_terminal
  name?: string            // rename target name / new terminal name
  gridStyle?: GridStyle
  confidence: 'high' | 'low'
}
```

- The LLM receives workspace **names and ids** and returns ids directly —
  fuzzy name resolution is the LLM's job. Our executor only validates that the
  ids exist in the live state (the workspace may have changed since the
  snapshot); a missing id downgrades to the confirm overlay with an error note.
- **Immediate** (toast): `switch_feature`, `toggle_grid`, `switch_tab`,
  `set_grid_style`, `hide_terminal` (reversible via `showTerminal`). Note:
  entering the grid un-hides the feature's X-ed terminals
  (`toggleFeatureViewMode`'s existing "fresh survey" semantics) — the toast
  text mentions it so it is not mistaken for a voice bug.
- **Confirm overlay:** `add_terminal`, `close_terminal` (kills a PTY),
  `rename_feature`, `rename_terminal`. Also forced for `confidence: 'low'`,
  invalid ids, and `unknown` (overlay then shows only the transcript and an
  explanation).
- `add_terminal` reuses the EXACT creation path of the quick-launch buttons:
  App's `launchAgent` handler (`App.tsx`) is extracted so voice and buttons
  share it, extended with an optional prompt. That path generates
  `sessionId = createId()` for claude and passes it to both
  `agentLaunchCommand` and the `addTerminal` input (preserving the resume
  pin), and for codex captures the session id post-launch via
  `captureAgentSession`. The spoken prompt is appended as
  `' ' + shellSingleQuote(prompt)` (the `agentContinueCommand` pattern in
  `src/renderer/src/agents.ts`); for `kind: 'shell'`, the spoken prompt (if
  any) becomes the `startupCommand` verbatim — always behind the confirm
  overlay. When no name is spoken, the terminal name defaults to the agent's
  `defaultName` (`claude`/`codex`) or `'shell'`, same as the existing buttons.

## Components

| Module | Role |
|---|---|
| `src/shared/voice.ts` | `VoiceCommand`, `VoiceAction`, `WorkspaceSnapshot`, `VoiceStateEvent` types; pure schema constants shared by main and renderer |
| `src/shared/ipc.ts` | new channels: `voiceStart` (`voice:start`, main→renderer), `voiceAudio` (`voice:audio`), `voiceState` (`voice:state`), `voiceResult` (`voice:result`), `voiceCancel` (`voice:cancel`) |
| `src/main/voice/transcriber.ts` | `utilityProcess` wrapper around `@kutalia/whisper-node-addon`; lazy model load, kept warm after first use; Vulkan if detected, CPU otherwise |
| `src/main/voice/modelDownload.ts` | first-use model download from Hugging Face into `userData/voice-models/`, progress via `voice:state` |
| `src/main/voice/translit.ts` | pure ćirilica→latinica transliteration |
| `src/main/voice/intent.ts` | Groq client (fetch, JSON mode, 10 s timeout); builds the system prompt from schema + snapshot; response validation |
| `src/main/voice/index.ts` | orchestration + `globalShortcut` registration + config load |
| `src/preload/index.ts` | `BrainApi` additions: `onVoiceStart`, `sendVoiceAudio`, `onVoiceState`, `onVoiceResult`, `cancelVoice`, `startVoice` (mic button path) |
| `src/renderer/src/voice/recorder.ts` | `getUserMedia` + AudioWorklet downsample to 16 kHz mono; RMS silence detector (pure function over PCM chunks) |
| `src/renderer/src/voice/executor.ts` | pure functions: `VoiceCommand` + `AppState` → `{ run: (s) => AppState } \| { confirm: ... } \| { delegate: ... } \| { error: ... }`. Pure store actions carry `run`; `close_terminal` and `add_terminal` return `delegate` descriptors that App-level glue routes through the existing handlers (`onDeleteTerminal`'s reviewer branch, extracted `launchAgent`) — those flows are effectful and cannot be expressed as pure state transforms |
| `src/renderer/src/voice/useVoice.ts` | state machine hook: idle → listening → transcribing → parsing → confirm → done/error |
| `src/renderer/src/voice/VoiceOverlay.tsx` | overlay UI: mic indicator, live state, transcript, parsed command summary, editable prompt textarea, Enter/Esc |
| `Sidebar` (existing) | small mic button as secondary trigger |

## STT details

- Candidate models (all permissive licenses, all with ready GGML/conversion
  paths):
  - [`Sagicc/whisper-large-v3-sr-cmb`](https://huggingface.co/Sagicc/whisper-large-v3-sr-cmb)
    — best Serbian (4.15 % WER normalized on CV13), Apache 2.0, ~1.1 GB at q5.
  - [`Sagicc/whisper-medium-sr-combined`](https://huggingface.co/Sagicc/whisper-medium-sr-combined)
    — 7.88 % WER, ~0.5 GB, faster on CPU.
  - vanilla `large-v3-turbo` q5 — likely better for English-heavy utterances.
- **The default model is chosen by measurement, not in this spec:** a benchmark
  script (part of the implementation plan) runs fixture WAV recordings of real
  commands through each candidate; criteria are name accuracy (do
  project/feature names survive?) and end-to-end latency ≤ ~2.5 s. The model
  id stays a config string either way.
- Inference params: `language: 'sr'`, `initial_prompt` written in latinica
  containing the command verbs plus current project/feature names (≤ 224
  tokens) — biases both the output script and the vocabulary.
- All transcripts are transliterated to latinica before intent parsing, so
  Cyrillic output (common for Serbian fine-tunes) costs nothing.

## Intent details

- Groq chat completions endpoint, JSON mode, free tier (2 000 req/day — far
  above personal use). Model id is a config string (default: the current
  free-tier Llama, e.g. `llama-3.3-70b-versatile`).
- Request context: transliterated transcript + `WorkspaceSnapshot`
  (`groups → features → terminals`, names + ids + kinds, plus
  `activeFeatureId` / `activeTerminalId` so "ovaj terminal" resolves, and a
  `hidden` flag on terminals so ordinal references like "drugi tab" resolve
  against the VISIBLE tab order) + the command schema with per-action examples
  in Serbian and English.
- API key: `GROQ_API_KEY` env var, overriding `groqApiKey` in
  `userData/voice.json`. Read in main only.
- Privacy line for the README: audio never leaves the machine; the transcript
  and workspace names are sent to Groq.

## Error handling

- **Mic permission denied** → overlay error with instructions.
- **`globalShortcut` registration fails** → startup toast; the sidebar mic
  button still works.
- **Whisper utilityProcess crash** → process restarted, current command ends
  in the error state.
- **Groq timeout (10 s) / network / 429** → error state showing the transcript
  ("ponovi, ili proveri mrežu") — the transcription work is not silently lost.
- **Model download failure** → error state with retry on next activation;
  partial downloads are resumed or discarded by checksum.
- **Invalid ids / `unknown` / low confidence** → confirm overlay, never silent
  execution.
- Esc cancels at any stage; a new activation while one is in flight cancels
  the previous one.

## Configuration & packaging

- `userData/voice.json`: `{ enabled, shortcut, modelId, groqModel,
  groqApiKey?, language }`. Default shortcut `Ctrl+Alt+Space`. Missing file =
  defaults with `enabled: true`.
- Models live in `userData/voice-models/` (gitignored territory, ~0.5–1.1 GB).
- electron-builder: add the whisper addon to `asarUnpack` (same pattern as
  `node-pty`). Confirm the addon ships Electron-compatible N-API prebuilds
  (its README claims so); otherwise add it to the `rebuild` script alongside
  node-pty.

## Testing

Vitest, following the existing `X.test.ts`-next-to-module pattern:

- `translit.test.ts` — ćirilica→latinica incl. nj/lj/dž digraphs.
- `executor.test.ts` — every action maps to the right store call or
  `delegate` descriptor; the immediate-vs-confirm classification table;
  `close_terminal` on a reviewer terminal delegates to the `review.stopLoop`
  branch (never bare `removeTerminal`); invalid id and `unknown` downgrade
  paths; live-state validation against a changed workspace.
- `intent.test.ts` — prompt builder (snapshot serialization, schema), response
  validation (malformed JSON, unknown action, missing required fields), Groq
  mocked at the fetch layer.
- `recorder` silence detector — pure-function tests over synthetic PCM chunks.
- Snapshot builder — names/ids/active flags from a fixture `AppState`.

Not in CI: the audio path itself (microphone → whisper). Covered by a manual
E2E checklist (Serbian, English, mixed commands; all v1 actions; cancel
paths; voice "toggle grid" on a feature with hidden terminals — verify the
un-hide is communicated, not surprising) and by the model benchmark script
over fixture WAVs.

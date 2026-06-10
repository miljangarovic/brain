# Voice Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voice control (Serbian + English) for navigation, terminal creation with a spoken prompt, and terminal management — local whisper.cpp STT, Groq free-tier intent parsing, hybrid confirm UX.

**Architecture:** Global shortcut (main) toggles recording in the renderer (getUserMedia → 16 kHz mono PCM). PCM + a workspace-names snapshot go to main, which transcribes in a `utilityProcess` (whisper.cpp via `@kutalia/whisper-node-addon`), transliterates to latinica, and calls Groq (JSON mode) to produce a `VoiceCommand`. The renderer validates ids against live state and either applies a pure store action (+ toast) or shows a confirm overlay; `close_terminal`/`add_terminal` delegate to the existing App handlers (reviewer branch, `launchAgent` with sessionId pinning).

**Tech Stack:** Electron 31 (main/preload/renderer), React 18, TypeScript, vitest, `@kutalia/whisper-node-addon` (prebuilt N-API, Vulkan/CPU), Groq `chat/completions` (free tier), Sagicc Serbian whisper GGML models from Hugging Face.

**Spec:** `docs/superpowers/specs/2026-06-10-voice-commands-design.md`

**Deviations from spec (intentional, small):**
1. No `startVoice` preload method — the sidebar mic button calls the renderer-side voice controller directly (same code path as the `voice:start` listener); a renderer→main→renderer round-trip would add nothing.
2. The whisper addon is fed a temp **WAV file** (`fname_inp`) encoded from the PCM, because that is the addon's documented stable API. Direct PCM input (the addon supports it; exact param name is in its `.d.ts`) is a follow-up optimization, not v1.
3. "Model kept warm after first use" may not hold: the addon's documented API is stateless (`transcribe({ model: path, … })` per call), which likely reloads the model each command. Task 9 Step 1 checks the `.d.ts` for a persistent-context API and uses it if present; otherwise the benchmark's ≤ ~2.5 s latency rule governs the model choice with the reload cost included honestly.
4. The spec's middle benchmark candidate `Sagicc/whisper-medium-sr-combined` is substituted with `Sagicc` **small**-sr — the Sagicc/Whisper.cpp HF repo only ships large + small GGML. If small loses on accuracy while large misses the latency bar, converting medium with whisper.cpp's conversion script is the follow-up candidate.
5. Invalid/stale ids surface as the error toast (with the transcript), not the spec's "confirm overlay with an error note" — functionally equivalent (nothing executable to confirm, never silent), and simpler.

**⚠ Before starting:** `App.tsx`, `Sidebar.tsx`, `Sidebar.test.tsx` carry uncommitted user changes in the working tree (`git status`). Ask the user to commit/stash them first — Tasks 15–16 modify those files.

**Verified facts used below (checked 2026-06-10):**
- `https://huggingface.co/api/models/Sagicc/Whisper.cpp` lists `ggml-large-v3-sr-q5_0.bin` and `ggml-whisper-small-sr-q5_0.bin`.
- `@kutalia/whisper-node-addon@1.1.0` on npm: prebuilt .node for Linux x64/arm64, mac, win; API `whisper.transcribe({ fname_inp, model, language, use_gpu })` returning segments; MIT.
- Groq endpoint: `POST https://api.groq.com/openai/v1/chat/completions` with `response_format: { type: 'json_object' }`.

---

### Task 1: Shared voice types, validation, IPC channels

**Files:**
- Create: `src/shared/voice.ts`
- Create: `src/shared/voice.test.ts`
- Modify: `src/shared/ipc.ts` (add 5 channels at the end of the `IPC` object)

- [ ] **Step 1: Write the failing test**

`src/shared/voice.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateVoiceCommand } from './voice'

describe('validateVoiceCommand', () => {
  it('passes a valid command through', () => {
    const cmd = validateVoiceCommand({ action: 'switch_feature', featureId: 'f1', confidence: 'high' })
    expect(cmd).toEqual({ action: 'switch_feature', featureId: 'f1', confidence: 'high' })
  })
  it('non-object input → unknown/low', () => {
    expect(validateVoiceCommand('garbage')).toEqual({ action: 'unknown', confidence: 'low' })
    expect(validateVoiceCommand(null)).toEqual({ action: 'unknown', confidence: 'low' })
  })
  it('unknown action → unknown/low', () => {
    expect(validateVoiceCommand({ action: 'fly_to_moon', confidence: 'high' }))
      .toEqual({ action: 'unknown', confidence: 'low' })
  })
  it('missing/invalid confidence defaults to low', () => {
    expect(validateVoiceCommand({ action: 'toggle_grid' }).confidence).toBe('low')
    expect(validateVoiceCommand({ action: 'toggle_grid', confidence: 'banana' }).confidence).toBe('low')
  })
  it('strips invalid optional fields, keeps valid ones', () => {
    const cmd = validateVoiceCommand({
      action: 'add_terminal', featureId: 42, kind: 'claude', prompt: 'fix tests',
      gridStyle: 'diagonal', name: 7, confidence: 'high'
    })
    expect(cmd).toEqual({ action: 'add_terminal', kind: 'claude', prompt: 'fix tests', confidence: 'high' })
  })
  it('keeps a valid gridStyle', () => {
    expect(validateVoiceCommand({ action: 'set_grid_style', gridStyle: 'cols', confidence: 'high' }).gridStyle).toBe('cols')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/voice.test.ts`
Expected: FAIL — `Cannot find module './voice'`

- [ ] **Step 3: Write the implementation**

`src/shared/voice.ts`:

```ts
// Voice command domain: the JSON contract between the Groq intent parser
// (main) and the renderer executor. validateVoiceCommand is SHAPE validation
// only — id existence is checked in the renderer against live state.
import type { GridStyle, TerminalKind } from './types'

export const VOICE_ACTIONS = [
  'switch_feature', 'toggle_grid', 'switch_tab', 'set_grid_style',
  'hide_terminal', 'add_terminal', 'close_terminal',
  'rename_feature', 'rename_terminal', 'unknown'
] as const
export type VoiceAction = (typeof VOICE_ACTIONS)[number]

const GRID_STYLES: GridStyle[] = ['auto', 'auto-left', 'auto-top', 'auto-bottom', 'rows', 'cols']
const KINDS: TerminalKind[] = ['shell', 'claude', 'codex']

export interface VoiceCommand {
  action: VoiceAction
  featureId?: string
  terminalId?: string
  kind?: TerminalKind
  prompt?: string
  name?: string
  gridStyle?: GridStyle
  confidence: 'high' | 'low'
}

export interface SnapshotTerminal { id: string; name: string; kind: TerminalKind; hidden?: boolean }
export interface SnapshotFeature { id: string; name: string; terminals: SnapshotTerminal[] }
export interface SnapshotGroup { id: string; name: string; features: SnapshotFeature[] }
export interface WorkspaceSnapshot {
  groups: SnapshotGroup[]
  activeFeatureId: string | null
  activeTerminalId: string | null
}

// Progress/phase events streamed main → renderer while a command is processed.
export type VoiceStateEvent =
  | { phase: 'transcribing' }
  | { phase: 'parsing'; transcript: string }
  | { phase: 'downloading-model'; received: number; total: number | null }
  | { phase: 'error'; message: string; transcript?: string }

export interface VoiceResult { transcript: string; command: VoiceCommand }

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

export function validateVoiceCommand(raw: unknown): VoiceCommand {
  if (typeof raw !== 'object' || raw === null) return { action: 'unknown', confidence: 'low' }
  const o = raw as Record<string, unknown>
  if (!VOICE_ACTIONS.includes(o.action as VoiceAction) || o.action === 'unknown') {
    return { action: 'unknown', confidence: 'low' }
  }
  const cmd: VoiceCommand = {
    action: o.action as VoiceAction,
    confidence: o.confidence === 'high' ? 'high' : 'low'
  }
  const featureId = str(o.featureId); if (featureId) cmd.featureId = featureId
  const terminalId = str(o.terminalId); if (terminalId) cmd.terminalId = terminalId
  if (KINDS.includes(o.kind as TerminalKind)) cmd.kind = o.kind as TerminalKind
  const prompt = str(o.prompt); if (prompt) cmd.prompt = prompt
  const name = str(o.name); if (name) cmd.name = name
  if (GRID_STYLES.includes(o.gridStyle as GridStyle)) cmd.gridStyle = o.gridStyle as GridStyle
  return cmd
}
```

In `src/shared/ipc.ts`, add before the closing `} as const`:

```ts
  shellOpenExternal: 'shell:openExternal',
  voiceStart: 'voice:start',
  voiceAudio: 'voice:audio',
  voiceState: 'voice:state',
  voiceResult: 'voice:result',
  voiceCancel: 'voice:cancel'
```

(The `shellOpenExternal` line is currently the LAST entry — shown for placement; append the five `voice*` lines after it, adding the comma to `shellOpenExternal`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/voice.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/shared/voice.ts src/shared/voice.test.ts src/shared/ipc.ts
git commit -m "feat(voice): shared command schema, validation, IPC channels"
```

---

### Task 2: Cyrillic→Latin transliteration (main)

**Files:**
- Create: `src/main/voice/translit.ts`
- Create: `src/main/voice/translit.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/voice/translit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toLatin } from './translit'

describe('toLatin', () => {
  it('transliterates a Serbian Cyrillic sentence', () => {
    expect(toLatin('Прикажи грид за фичу фајл пејнс')).toBe('Prikaži grid za fiču fajl pejns')
  })
  it('handles the digraph letters љ њ џ in both cases', () => {
    expect(toLatin('љуља Љиљана, њива Њ, џеп Џ')).toBe('ljulja Ljiljana, njiva Nj, džep Dž')
  })
  it('covers ђ ћ ж ч ш and uppercase', () => {
    expect(toLatin('Ђурђевак ћошак Жижак Чвор Шума')).toBe('Đurđevak ćošak Žižak Čvor Šuma')
  })
  it('leaves latin text and punctuation untouched', () => {
    expect(toLatin('dodaj claude terminal u feature file-panes!')).toBe('dodaj claude terminal u feature file-panes!')
  })
  it('mixed scripts: only cyrillic characters change', () => {
    expect(toLatin('додај terminal у file-panes')).toBe('dodaj terminal u file-panes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/voice/translit.test.ts`
Expected: FAIL — `Cannot find module './translit'`

- [ ] **Step 3: Write the implementation**

`src/main/voice/translit.ts`:

```ts
// Deterministic Serbian Cyrillic → Latin map. Whisper Serbian fine-tunes often
// emit Cyrillic; everything downstream (intent parsing, name matching) works
// on latinica, so transcripts are normalized here. Digraphs (љ→lj, њ→nj,
// џ→dž) are single Cyrillic characters — a plain char map handles them.
const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'č', џ: 'dž', ш: 'š',
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Ђ: 'Đ', Е: 'E', Ж: 'Ž', З: 'Z',
  И: 'I', Ј: 'J', К: 'K', Л: 'L', Љ: 'Lj', М: 'M', Н: 'N', Њ: 'Nj', О: 'O',
  П: 'P', Р: 'R', С: 'S', Т: 'T', Ћ: 'Ć', У: 'U', Ф: 'F', Х: 'H', Ц: 'C',
  Ч: 'Č', Џ: 'Dž', Ш: 'Š'
}

export function toLatin(s: string): string {
  let out = ''
  for (const ch of s) out += MAP[ch] ?? ch
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/voice/translit.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/translit.ts src/main/voice/translit.test.ts
git commit -m "feat(voice): cyrillic→latin transliteration"
```

---

### Task 3: WAV encoder (main)

**Files:**
- Create: `src/main/voice/wav.ts`
- Create: `src/main/voice/wav.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/voice/wav.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { encodeWavPcm16 } from './wav'

describe('encodeWavPcm16', () => {
  it('writes a valid 16kHz mono 16-bit RIFF header', () => {
    const buf = encodeWavPcm16(new Float32Array([0, 0.5, -0.5]), 16000)
    expect(buf.length).toBe(44 + 3 * 2)
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE')
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ')
    expect(buf.toString('ascii', 36, 40)).toBe('data')
    expect(buf.readUInt32LE(4)).toBe(36 + 6)        // riff chunk size
    expect(buf.readUInt16LE(22)).toBe(1)            // mono
    expect(buf.readUInt32LE(24)).toBe(16000)        // sample rate
    expect(buf.readUInt32LE(28)).toBe(16000 * 2)    // byte rate
    expect(buf.readUInt16LE(34)).toBe(16)           // bits per sample
    expect(buf.readUInt32LE(40)).toBe(6)            // data size
  })
  it('converts samples to little-endian int16 with clamping', () => {
    const buf = encodeWavPcm16(new Float32Array([0, 1, -1, 2, -2]), 16000)
    expect(buf.readInt16LE(44)).toBe(0)
    expect(buf.readInt16LE(46)).toBe(32767)
    expect(buf.readInt16LE(48)).toBe(-32768)
    expect(buf.readInt16LE(50)).toBe(32767)   // clamped
    expect(buf.readInt16LE(52)).toBe(-32768)  // clamped
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/voice/wav.test.ts`
Expected: FAIL — `Cannot find module './wav'`

- [ ] **Step 3: Write the implementation**

`src/main/voice/wav.ts`:

```ts
// Minimal mono 16-bit PCM WAV encoder — the whisper addon's stable input is a
// file path, so the recorded Float32 PCM is wrapped in a WAV container.
export function encodeWavPcm16(pcm: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    data.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)              // fmt chunk size
  header.writeUInt16LE(1, 20)               // PCM
  header.writeUInt16LE(1, 22)               // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)  // byte rate
  header.writeUInt16LE(2, 32)               // block align
  header.writeUInt16LE(16, 34)              // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/voice/wav.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/wav.ts src/main/voice/wav.test.ts
git commit -m "feat(voice): wav encoder for whisper input"
```

---

### Task 4: Renderer DSP helpers — downsample, concat, silence tracking

**Files:**
- Create: `src/renderer/src/voice/dsp.ts`
- Create: `src/renderer/src/voice/dsp.test.ts`

- [ ] **Step 1: Write the failing test**

`src/renderer/src/voice/dsp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { concatFloat32, downsample, rms, SilenceTracker } from './dsp'

const zeros = (n: number) => new Float32Array(n)
const tone = (n: number, amp = 0.5) => {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * 440 * i) / 48000)
  return a
}

describe('concatFloat32', () => {
  it('concatenates chunks in order', () => {
    const out = concatFloat32([new Float32Array([1, 2]), new Float32Array([3])])
    expect(Array.from(out)).toEqual([1, 2, 3])
  })
})

describe('downsample', () => {
  it('48k → 16k yields one third of the samples', () => {
    expect(downsample(zeros(4800), 48000, 16000).length).toBe(1600)
  })
  it('same rate returns input unchanged', () => {
    const input = tone(100)
    expect(downsample(input, 16000, 16000)).toBe(input)
  })
  it('preserves a constant signal', () => {
    const out = downsample(new Float32Array(90).fill(0.25), 48000, 16000)
    for (const v of out) expect(v).toBeCloseTo(0.25, 5)
  })
})

describe('rms', () => {
  it('is 0 for silence and >0 for a tone', () => {
    expect(rms(zeros(1024))).toBe(0)
    expect(rms(tone(1024))).toBeGreaterThan(0.1)
  })
})

describe('SilenceTracker', () => {
  // 48000 samples/s; chunks of 4800 = 100ms each.
  const chunkMs = (t: SilenceTracker, ms: number, silent: boolean) => {
    let last: 'continue' | 'stop' = 'continue'
    for (let i = 0; i < ms / 100; i++) last = t.push(silent ? zeros(4800) : tone(4800))
    return last
  }
  it('does not stop during initial silence (no speech yet)', () => {
    const t = new SilenceTracker({ sampleRate: 48000 })
    expect(chunkMs(t, 3000, true)).toBe('continue')
  })
  it('stops after holdMs of silence once speech was heard', () => {
    const t = new SilenceTracker({ sampleRate: 48000, holdMs: 1200, minSpeechMs: 250 })
    expect(chunkMs(t, 500, false)).toBe('continue')   // speech
    expect(chunkMs(t, 1100, true)).toBe('continue')   // not yet 1200ms silence
    expect(chunkMs(t, 200, true)).toBe('stop')
  })
  it('speech resets the silence run', () => {
    const t = new SilenceTracker({ sampleRate: 48000, holdMs: 1200, minSpeechMs: 250 })
    chunkMs(t, 500, false)
    chunkMs(t, 1000, true)
    chunkMs(t, 200, false)                            // speech again
    expect(chunkMs(t, 1100, true)).toBe('continue')
  })
  it('hard-stops at maxMs regardless of speech', () => {
    const t = new SilenceTracker({ sampleRate: 48000, maxMs: 2000 })
    expect(chunkMs(t, 2100, false)).toBe('stop')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/voice/dsp.test.ts`
Expected: FAIL — `Cannot find module './dsp'`

- [ ] **Step 3: Write the implementation**

`src/renderer/src/voice/dsp.ts`:

```ts
// Pure DSP helpers for the voice recorder. Kept free of Web Audio types so
// they are unit-testable in jsdom/node.

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

// Linear-interpolation resampler — fine for speech into whisper's 16 kHz.
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const outLen = Math.floor((input.length * toRate) / fromRate)
  const out = new Float32Array(outLen)
  const ratio = fromRate / toRate
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0)
  }
  return out
}

export function rms(chunk: Float32Array): number {
  let sum = 0
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
  return Math.sqrt(sum / (chunk.length || 1))
}

// Auto-stop policy: never stop before any speech was heard (the user may take
// a moment to start talking); once cumulative speech ≥ minSpeechMs, holdMs of
// continuous silence ends the recording. maxMs is the hard cap.
export class SilenceTracker {
  private readonly sampleRate: number
  private readonly threshold: number
  private readonly holdMs: number
  private readonly minSpeechMs: number
  private readonly maxMs: number
  private elapsedMs = 0
  private speechMs = 0
  private silenceRunMs = 0

  constructor(opts: { sampleRate: number; threshold?: number; holdMs?: number; minSpeechMs?: number; maxMs?: number }) {
    this.sampleRate = opts.sampleRate
    this.threshold = opts.threshold ?? 0.015
    this.holdMs = opts.holdMs ?? 1200
    this.minSpeechMs = opts.minSpeechMs ?? 250
    this.maxMs = opts.maxMs ?? 20000
  }

  push(chunk: Float32Array): 'continue' | 'stop' {
    const ms = (chunk.length / this.sampleRate) * 1000
    this.elapsedMs += ms
    if (rms(chunk) >= this.threshold) { this.speechMs += ms; this.silenceRunMs = 0 }
    else this.silenceRunMs += ms
    if (this.elapsedMs >= this.maxMs) return 'stop'
    if (this.speechMs >= this.minSpeechMs && this.silenceRunMs >= this.holdMs) return 'stop'
    return 'continue'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/voice/dsp.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/dsp.ts src/renderer/src/voice/dsp.test.ts
git commit -m "feat(voice): renderer dsp helpers (downsample, silence tracker)"
```

---

### Task 5: Workspace snapshot builder (renderer)

**Files:**
- Create: `src/renderer/src/voice/snapshot.ts`
- Create: `src/renderer/src/voice/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

`src/renderer/src/voice/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSnapshot } from './snapshot'
import { createInitialState, addGroup, addFeature, addTerminal, hideTerminal } from '../store'

function fixture() {
  let s = createInitialState()
  s = addGroup(s, 'mappit', '/code/mappit')
  const gid = s.workspace.groups[0].id
  s = addFeature(s, gid, 'file-panes')
  const fid = s.workspace.groups[0].features[0].id
  s = addTerminal(s, fid, { name: 'claude', kind: 'claude' })
  s = addTerminal(s, fid, { name: 'shell' })
  return s
}

describe('buildSnapshot', () => {
  it('maps groups → features → terminals with names, ids and kinds', () => {
    const s = fixture()
    const snap = buildSnapshot(s)
    expect(snap.groups).toHaveLength(1)
    expect(snap.groups[0].name).toBe('mappit')
    const f = snap.groups[0].features[0]
    expect(f.name).toBe('file-panes')
    expect(f.terminals.map((t) => t.kind)).toEqual(['claude', 'shell'])
    expect(f.terminals.every((t) => typeof t.id === 'string' && t.id.length > 0)).toBe(true)
  })
  it('carries active ids', () => {
    const s = fixture()
    const snap = buildSnapshot(s)
    expect(snap.activeFeatureId).toBe(s.activeFeatureId)
    expect(snap.activeTerminalId).toBe(s.activeTerminalId)
  })
  it('flags hidden terminals (and only them)', () => {
    let s = fixture()
    const tid = s.workspace.groups[0].features[0].terminals[1].id
    s = hideTerminal(s, tid)
    const terms = buildSnapshot(s).groups[0].features[0].terminals
    expect(terms.find((t) => t.id === tid)?.hidden).toBe(true)
    expect(terms.find((t) => t.id !== tid)?.hidden).toBeUndefined()
  })
  it('nulls activeTerminalId when it is not a terminal (a file pane is selected)', () => {
    const s = { ...fixture(), activeTerminalId: 'some-file-pane-id' }
    expect(buildSnapshot(s).activeTerminalId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/voice/snapshot.test.ts`
Expected: FAIL — `Cannot find module './snapshot'`

- [ ] **Step 3: Write the implementation**

`src/renderer/src/voice/snapshot.ts`:

```ts
// The names+ids context the intent LLM sees. hidden matters for ordinal tab
// references ("drugi tab" counts only visible tabs); archived features are
// deliberately absent — they have no live panes to act on.
import type { AppState } from '../store'
import type { WorkspaceSnapshot } from '@shared/voice'

export function buildSnapshot(s: AppState): WorkspaceSnapshot {
  // activeTerminalId can hold a FILE PANE id (panes participate in selection,
  // see setActiveTerminal/cycleTab) — the LLM must never target it as a
  // terminal, so it is nulled unless it names a real terminal.
  const terminalIds = new Set(
    s.workspace.groups.flatMap((g) => g.features).flatMap((f) => f.terminals).map((t) => t.id)
  )
  return {
    groups: s.workspace.groups.map((g) => ({
      id: g.id,
      name: g.name,
      features: g.features.map((f) => ({
        id: f.id,
        name: f.name,
        terminals: f.terminals.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind ?? 'shell',
          ...(s.hidden.includes(t.id) ? { hidden: true as const } : {})
        }))
      }))
    })),
    activeFeatureId: s.activeFeatureId,
    activeTerminalId: s.activeTerminalId && terminalIds.has(s.activeTerminalId) ? s.activeTerminalId : null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/voice/snapshot.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/snapshot.ts src/renderer/src/voice/snapshot.test.ts
git commit -m "feat(voice): workspace snapshot builder for intent context"
```

---

### Task 6: Voice config (main)

**Files:**
- Create: `src/main/voice/config.ts`
- Create: `src/main/voice/config.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/voice/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseVoiceConfig, DEFAULT_VOICE_CONFIG } from './config'

describe('parseVoiceConfig', () => {
  it('returns defaults for non-object input', () => {
    expect(parseVoiceConfig(null)).toEqual(DEFAULT_VOICE_CONFIG)
    expect(parseVoiceConfig('x')).toEqual(DEFAULT_VOICE_CONFIG)
  })
  it('merges valid fields over defaults', () => {
    const c = parseVoiceConfig({ shortcut: 'Ctrl+Alt+M', groqApiKey: 'gsk_123', enabled: false })
    expect(c.shortcut).toBe('Ctrl+Alt+M')
    expect(c.groqApiKey).toBe('gsk_123')
    expect(c.enabled).toBe(false)
    expect(c.modelId).toBe(DEFAULT_VOICE_CONFIG.modelId)
  })
  it('ignores wrong-typed fields', () => {
    const c = parseVoiceConfig({ shortcut: 7, enabled: 'yes', modelId: ['x'] })
    expect(c).toEqual(DEFAULT_VOICE_CONFIG)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/voice/config.test.ts`
Expected: FAIL — `Cannot find module './config'`

- [ ] **Step 3: Write the implementation**

`src/main/voice/config.ts`:

```ts
// userData/voice.json — missing file or fields fall back to defaults; the
// GROQ_API_KEY env var overrides the file's key. Read in main ONLY: the key
// must never reach the renderer.
import { promises as fsp } from 'fs'
import { join } from 'path'

export interface VoiceConfig {
  enabled: boolean
  shortcut: string
  modelId: string
  groqModel: string
  groqApiKey?: string
  language: string
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  enabled: true,
  shortcut: 'Ctrl+Alt+Space',
  modelId: 'sagicc-large-v3-sr-q5_0',
  groqModel: 'llama-3.3-70b-versatile',
  language: 'sr'
}

export function parseVoiceConfig(raw: unknown): VoiceConfig {
  const c = { ...DEFAULT_VOICE_CONFIG }
  if (typeof raw !== 'object' || raw === null) return c
  const o = raw as Record<string, unknown>
  if (typeof o.enabled === 'boolean') c.enabled = o.enabled
  if (typeof o.shortcut === 'string' && o.shortcut) c.shortcut = o.shortcut
  if (typeof o.modelId === 'string' && o.modelId) c.modelId = o.modelId
  if (typeof o.groqModel === 'string' && o.groqModel) c.groqModel = o.groqModel
  if (typeof o.groqApiKey === 'string' && o.groqApiKey) c.groqApiKey = o.groqApiKey
  if (typeof o.language === 'string' && o.language) c.language = o.language
  return c
}

export async function loadVoiceConfig(userDataDir: string): Promise<VoiceConfig> {
  let raw: unknown = null
  try { raw = JSON.parse(await fsp.readFile(join(userDataDir, 'voice.json'), 'utf8')) } catch { /* defaults */ }
  const c = parseVoiceConfig(raw)
  if (process.env.GROQ_API_KEY) c.groqApiKey = process.env.GROQ_API_KEY
  return c
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/voice/config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/config.ts src/main/voice/config.test.ts
git commit -m "feat(voice): voice.json config with env key override"
```

---

### Task 7: Model registry + downloader (main)

**Files:**
- Create: `src/main/voice/models.ts`
- Create: `src/main/voice/models.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/voice/models.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { VOICE_MODELS, ensureModel } from './models'

const dir = join(tmpdir(), `voice-models-test-${process.pid}`)
beforeEach(async () => { await fsp.rm(dir, { recursive: true, force: true }) })

const okResponse = (bytes: Uint8Array, total?: number) => ({
  ok: true,
  status: 200,
  headers: { get: (h: string) => (h === 'content-length' && total ? String(total) : null) },
  body: new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(bytes); c.close() }
  })
}) as unknown as Response

describe('VOICE_MODELS', () => {
  it('contains the three benchmark candidates with HF resolve urls', () => {
    for (const id of ['sagicc-large-v3-sr-q5_0', 'sagicc-small-sr-q5_0', 'large-v3-turbo-q5_0']) {
      expect(VOICE_MODELS[id].url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/main\/ggml-.+\.bin$/)
      expect(VOICE_MODELS[id].file).toMatch(/^ggml-.+\.bin$/)
    }
  })
})

describe('ensureModel', () => {
  it('downloads to <file>.part, renames, reports progress', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(bytes, 4))
    const progress: [number, number | null][] = []
    const path = await ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, (r, t) => progress.push([r, t]))
    expect(path).toBe(join(dir, VOICE_MODELS['sagicc-small-sr-q5_0'].file))
    expect(Array.from(await fsp.readFile(path))).toEqual([1, 2, 3, 4])
    expect(progress[progress.length - 1]).toEqual([4, 4])
    await expect(fsp.stat(path + '.part')).rejects.toThrow()
  })
  it('returns the existing file without fetching', async () => {
    await fsp.mkdir(dir, { recursive: true })
    const path = join(dir, VOICE_MODELS['sagicc-small-sr-q5_0'].file)
    await fsp.writeFile(path, 'x')
    const fetchImpl = vi.fn()
    expect(await ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, () => {})).toBe(path)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('throws on http error and leaves no .part behind', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response)
    await expect(ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, () => {})).rejects.toThrow(/404/)
    const files = await fsp.readdir(dir).catch(() => [])
    expect(files.filter((f) => f.endsWith('.part'))).toEqual([])
  })
  it('throws on unknown model id', async () => {
    await expect(ensureModel('nope', dir, vi.fn(), () => {})).rejects.toThrow(/unknown model/i)
  })
  it('concurrent calls share ONE in-flight download (no interleaved .part writes)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(new Uint8Array([9, 9]), 2))
    const [a, b] = await Promise.all([
      ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, () => {}),
      ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, () => {})
    ])
    expect(a).toBe(b)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('a short read (body < content-length) throws and leaves no model file', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(new Uint8Array([1, 2]), 10))
    await expect(ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, () => {})).rejects.toThrow(/truncated/)
    const files = await fsp.readdir(dir).catch(() => [])
    expect(files).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/voice/models.test.ts`
Expected: FAIL — `Cannot find module './models'`

- [ ] **Step 3: Write the implementation**

`src/main/voice/models.ts`:

```ts
// GGML model registry + first-use downloader. Downloads stream to
// <file>.part and rename on success, so a crash never leaves a torn model
// file that whisper would try to load. Single-flight per target path:
// concurrent activations during a first-run download must share one fetch —
// two writers on the same .part would interleave and the torn result would
// be renamed and cached as a valid model forever.
import { createWriteStream, promises as fsp } from 'fs'
import { dirname, join } from 'path'

export const VOICE_MODELS: Record<string, { url: string; file: string }> = {
  'sagicc-large-v3-sr-q5_0': {
    url: 'https://huggingface.co/Sagicc/Whisper.cpp/resolve/main/ggml-large-v3-sr-q5_0.bin',
    file: 'ggml-large-v3-sr-q5_0.bin'
  },
  'sagicc-small-sr-q5_0': {
    url: 'https://huggingface.co/Sagicc/Whisper.cpp/resolve/main/ggml-whisper-small-sr-q5_0.bin',
    file: 'ggml-whisper-small-sr-q5_0.bin'
  },
  'large-v3-turbo-q5_0': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    file: 'ggml-large-v3-turbo-q5_0.bin'
  }
}

const inFlight = new Map<string, Promise<string>>()

export function ensureModel(
  modelId: string,
  dir: string,
  fetchImpl: typeof fetch,
  onProgress: (received: number, total: number | null) => void
): Promise<string> {
  const entry = VOICE_MODELS[modelId]
  if (!entry) return Promise.reject(new Error(`unknown model id: ${modelId}`))
  const path = join(dir, entry.file)
  const existing = inFlight.get(path)
  if (existing) return existing
  const p = download(entry.url, path, fetchImpl, onProgress).finally(() => inFlight.delete(path))
  inFlight.set(path, p)
  return p
}

async function download(
  url: string,
  path: string,
  fetchImpl: typeof fetch,
  onProgress: (received: number, total: number | null) => void
): Promise<string> {
  if (await fsp.stat(path).then(() => true, () => false)) return path

  await fsp.mkdir(dirname(path), { recursive: true })
  const part = path + '.part'
  try {
    const res = await fetchImpl(url)
    if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`)
    const len = res.headers.get('content-length')
    const total = len ? Number(len) : null
    const ws = createWriteStream(part)
    const reader = res.body.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      await new Promise<void>((resolve, reject) => ws.write(value, (e) => (e ? reject(e) : resolve())))
      onProgress(received, total)
    }
    await new Promise<void>((resolve, reject) => ws.end((e?: Error | null) => (e ? reject(e) : resolve())))
    // Cheap integrity check standing in for the spec's checksum: a body that
    // does not match its advertised size must never be renamed into place.
    if (total !== null && received !== total) {
      throw new Error(`model download truncated: ${received}/${total} bytes`)
    }
    await fsp.rename(part, path)
    return path
  } catch (err) {
    await fsp.rm(part, { force: true })
    throw err
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/voice/models.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/models.ts src/main/voice/models.test.ts
git commit -m "feat(voice): model registry and streaming downloader"
```

---

### Task 8: Groq intent parser (main)

**Files:**
- Create: `src/main/voice/intent.ts`
- Create: `src/main/voice/intent.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/voice/intent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildIntentMessages, parseIntentResponse, parseIntent, whisperInitialPrompt, VoiceIntentError } from './intent'
import type { WorkspaceSnapshot } from '@shared/voice'

const snap: WorkspaceSnapshot = {
  groups: [{
    id: 'g1', name: 'mappit', features: [{
      id: 'f1', name: 'file-panes', terminals: [
        { id: 't1', name: 'claude', kind: 'claude' },
        { id: 't2', name: 'shell', kind: 'shell', hidden: true }
      ]
    }]
  }],
  activeFeatureId: 'f1',
  activeTerminalId: 't1'
}

describe('buildIntentMessages', () => {
  it('embeds snapshot ids/names, active ids, hidden flags and the transcript', () => {
    const [system, user] = buildIntentMessages('prebaci na file panes', snap)
    expect(system.role).toBe('system')
    expect(system.content).toContain('"f1"')
    expect(system.content).toContain('file-panes')
    expect(system.content).toContain('switch_feature')
    expect(system.content).toContain('hidden')
    expect(system.content).toContain('activeFeatureId')
    expect(user.role).toBe('user')
    expect(user.content).toContain('prebaci na file panes')
  })
})

describe('whisperInitialPrompt', () => {
  it('is latinica, contains command verbs and workspace names, ≤ ~800 chars', () => {
    const p = whisperInitialPrompt(snap)
    expect(p).toContain('mappit')
    expect(p).toContain('file-panes')
    expect(p).toMatch(/prebaci|dodaj|zatvori/)
    expect(p.length).toBeLessThan(900)
  })
})

describe('parseIntentResponse', () => {
  it('parses plain JSON', () => {
    expect(parseIntentResponse('{"action":"toggle_grid","featureId":"f1","confidence":"high"}'))
      .toEqual({ action: 'toggle_grid', featureId: 'f1', confidence: 'high' })
  })
  it('strips markdown fences', () => {
    expect(parseIntentResponse('```json\n{"action":"switch_tab","terminalId":"t1","confidence":"high"}\n```').action)
      .toBe('switch_tab')
  })
  it('garbage → unknown/low', () => {
    expect(parseIntentResponse('not json at all')).toEqual({ action: 'unknown', confidence: 'low' })
  })
})

describe('parseIntent', () => {
  const ok = (content: string) => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  }) as unknown as Response

  it('posts to groq with json mode and returns the validated command', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('{"action":"switch_feature","featureId":"f1","confidence":"high"}'))
    const cmd = await parseIntent({ transcript: 'prebaci na file panes', snapshot: snap, apiKey: 'gsk_x', model: 'llama-3.3-70b-versatile', fetchImpl })
    expect(cmd).toEqual({ action: 'switch_feature', featureId: 'f1', confidence: 'high' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.temperature).toBe(0)
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer gsk_x' })
  })
  it('429 → rate-limit error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response)
    await expect(parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl }))
      .rejects.toMatchObject({ kind: 'rate-limit' })
  })
  it('401/403 → auth error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response)
    await expect(parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl }))
      .rejects.toMatchObject({ kind: 'auth' })
  })
  it('abort → timeout error', async () => {
    const fetchImpl = vi.fn().mockImplementation((_u, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    )
    await expect(parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl, timeoutMs: 20 }))
      .rejects.toMatchObject({ kind: 'timeout' })
    expect(VoiceIntentError).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/voice/intent.test.ts`
Expected: FAIL — `Cannot find module './intent'`

- [ ] **Step 3: Write the implementation**

`src/main/voice/intent.ts`:

```ts
// Transcript → VoiceCommand via Groq (OpenAI-compatible chat completions,
// JSON mode). The LLM does the fuzzy name→id resolution: it sees the full
// names+ids snapshot and must answer with ids only. Shape validation happens
// here (validateVoiceCommand); id existence is the renderer's job.
import { validateVoiceCommand, type VoiceCommand, type WorkspaceSnapshot } from '@shared/voice'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export type IntentErrorKind = 'network' | 'auth' | 'rate-limit' | 'timeout'
export class VoiceIntentError extends Error {
  constructor(public kind: IntentErrorKind, message: string) { super(message) }
}

export interface ChatMessage { role: 'system' | 'user'; content: string }

export function buildIntentMessages(transcript: string, snapshot: WorkspaceSnapshot): [ChatMessage, ChatMessage] {
  const system = `You convert a voice command for a terminal-manager app into ONE JSON object.
The user speaks Serbian (latinica), English, or a mix. Workspace structure (projects = groups):

${JSON.stringify(snapshot, null, 1)}

Reply with ONLY a JSON object, no prose, shaped as:
{"action": "switch_feature|toggle_grid|switch_tab|set_grid_style|hide_terminal|add_terminal|close_terminal|rename_feature|rename_terminal|unknown",
 "featureId"?: string, "terminalId"?: string, "kind"?: "shell|claude|codex",
 "prompt"?: string, "name"?: string,
 "gridStyle"?: "auto|auto-left|auto-top|auto-bottom|rows|cols",
 "confidence": "high|low"}

Rules:
- Resolve spoken names fuzzily against the snapshot names (they may be mangled by speech-to-text, e.g. "fajl pejns" = "file-panes") and answer with the matching IDS from the snapshot, never names.
- When no feature/terminal is named, use activeFeatureId / activeTerminalId.
- Ordinal tab references ("drugi tab", "third tab") count only terminals WITHOUT "hidden": true, in snapshot order, within the active feature.
- add_terminal: "kind" defaults to "claude" when an agent is implied or nothing is said; "prompt" is the task the user dictated for the agent, verbatim, cleaned of filler words.
- rename_*: "name" is the new name.
- If the utterance is not one of these commands, or you are genuinely unsure which target is meant, use action "unknown" or set confidence "low".

Examples:
"prebaci na fajl pejns" → {"action":"switch_feature","featureId":"<id of file-panes>","confidence":"high"}
"otvori grid" → {"action":"toggle_grid","confidence":"high"}
"dodaj klod terminal u file panes sa promptom sredi testove" → {"action":"add_terminal","featureId":"<id>","kind":"claude","prompt":"sredi testove","confidence":"high"}
"close the second tab" → {"action":"hide_terminal","terminalId":"<id of 2nd visible terminal>","confidence":"high"}
"preimenuj feature u export import" → {"action":"rename_feature","featureId":"<active feature id>","name":"export import","confidence":"high"}
"change the grid style to columns" → {"action":"set_grid_style","gridStyle":"cols","confidence":"high"}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: transcript }
  ]
}

// Whisper biasing prompt: latinica (nudges the output script) + command verbs
// + the workspace names the user is likely to say. Whisper caps the initial
// prompt at 224 tokens — names are joined until a ~700-char budget runs out.
export function whisperInitialPrompt(snapshot: WorkspaceSnapshot): string {
  const names: string[] = []
  for (const g of snapshot.groups) {
    names.push(g.name)
    for (const f of g.features) names.push(f.name)
  }
  let list = ''
  for (const n of names) {
    if (list.length + n.length > 600) break
    list += (list ? ', ' : '') + n
  }
  return `Komande: prebaci na, otvori grid, zatvori grid, dodaj claude terminal, dodaj codex terminal, zatvori terminal, sakrij terminal, preimenuj, sa promptom. Imena: ${list}.`
}

export function parseIntentResponse(content: string): VoiceCommand {
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return validateVoiceCommand(JSON.parse(stripped)) } catch { return { action: 'unknown', confidence: 'low' } }
}

export async function parseIntent(opts: {
  transcript: string
  snapshot: WorkspaceSnapshot
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<VoiceCommand> {
  const { transcript, snapshot, apiKey, model, fetchImpl = fetch, timeoutMs = 10000 } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: buildIntentMessages(transcript, snapshot),
        temperature: 0,
        response_format: { type: 'json_object' }
      }),
      signal: ctrl.signal
    })
    if (!res.ok) {
      if (res.status === 429) throw new VoiceIntentError('rate-limit', 'Groq rate limit hit — try again in a minute')
      if (res.status === 401 || res.status === 403) throw new VoiceIntentError('auth', 'Groq API key rejected')
      throw new VoiceIntentError('network', `Groq error: HTTP ${res.status}`)
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] }
    return parseIntentResponse(data.choices?.[0]?.message?.content ?? '')
  } catch (err) {
    if (err instanceof VoiceIntentError) throw err
    if ((err as Error).name === 'AbortError') throw new VoiceIntentError('timeout', 'Groq request timed out')
    throw new VoiceIntentError('network', `Groq request failed: ${String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/voice/intent.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/intent.ts src/main/voice/intent.test.ts
git commit -m "feat(voice): groq intent parser with whisper bias prompt"
```

---

### Task 9: Whisper transcriber (addon install, utilityProcess child, parent wrapper)

**Files:**
- Modify: `package.json` (dependency)
- Modify: `electron.vite.config.ts` (second main entry)
- Create: `src/main/voice/transcribeResult.ts`
- Create: `src/main/voice/transcribeResult.test.ts`
- Create: `src/main/voice/transcriberChild.ts`
- Create: `src/main/voice/transcriber.ts`
- Create: `src/main/voice/transcriber.test.ts`

- [ ] **Step 1: Install the addon and inspect its real API**

```bash
npm install @kutalia/whisper-node-addon
node -e "const w = require('@kutalia/whisper-node-addon'); const t = w.transcribe ?? w.default?.transcribe; console.log(typeof t)"
find node_modules/@kutalia/whisper-node-addon -name '*.d.ts' | head -5
```

Expected: `function`. Open the listed `.d.ts` and confirm the option names used in Step 5 (`fname_inp`, `model`, `language`, `use_gpu`, and whether `no_timestamps` / `no_prints` / `prompt` exist — include each only if present; if the prompt option is named differently, e.g. `initial_prompt`, use that name). Also check for a **persistent-context / keep-model-loaded API** (anything like `init`, `createContext`, `keep_context`, a class wrapping a loaded model): the documented `transcribe({ model: path })` shape is stateless and likely reloads the ~1.1 GB model per call. If a warm API exists, load the model ONCE in the child (Step 5) and reuse it across requests; if not, the deviation is already declared in the plan header and the benchmark's latency rule (Task 17) governs the model choice with reload cost included.

- [ ] **Step 2: Write the failing test for result extraction**

`src/main/voice/transcribeResult.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractTranscript } from './transcribeResult'

describe('extractTranscript', () => {
  it('joins whisper.cpp segment triplets [from, to, text]', () => {
    expect(extractTranscript({ transcription: [['00:00', '00:02', ' prebaci na'], ['00:02', '00:03', ' file panes']] }))
      .toBe('prebaci na file panes')
  })
  it('accepts a bare segments array', () => {
    expect(extractTranscript([['0', '1', 'dodaj terminal']])).toBe('dodaj terminal')
  })
  it('accepts a plain string', () => {
    expect(extractTranscript('zatvori grid ')).toBe('zatvori grid')
  })
  it('anything else → empty string', () => {
    expect(extractTranscript(undefined)).toBe('')
    expect(extractTranscript({ foo: 1 })).toBe('')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/voice/transcribeResult.test.ts`
Expected: FAIL — `Cannot find module './transcribeResult'`

- [ ] **Step 4: Implement extraction, run test**

`src/main/voice/transcribeResult.ts`:

```ts
// The addon returns whisper.cpp segments ({ transcription: [[from, to, text], …] }
// in the upstream addon; tolerate a bare array or a string in case the fork
// changes shape between versions).
export function extractTranscript(result: unknown): string {
  if (typeof result === 'string') return result.trim()
  const segs = Array.isArray(result)
    ? result
    : (typeof result === 'object' && result !== null && Array.isArray((result as { transcription?: unknown }).transcription))
      ? (result as { transcription: unknown[] }).transcription
      : null
  if (!segs) return ''
  return segs
    .map((s) => (Array.isArray(s) && typeof s[2] === 'string' ? s[2] : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}
```

Run: `npx vitest run src/main/voice/transcribeResult.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the utilityProcess child**

`src/main/voice/transcriberChild.ts`:

```ts
// Runs inside an Electron utilityProcess: loads the whisper addon (native,
// heavy) and serves transcribe requests over parentPort. Kept out of the main
// process so inference never blocks it and a native crash cannot take the
// app down (the parent respawns this child).
import { extractTranscript } from './transcribeResult'

interface Req { id: number; wavPath: string; modelPath: string; language: string; prompt?: string }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@kutalia/whisper-node-addon')
const transcribe: (o: Record<string, unknown>) => Promise<unknown> = addon.transcribe ?? addon.default?.transcribe

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as Req
  void (async () => {
    try {
      // Option names verified against the addon's .d.ts in Task 9 Step 1.
      const result = await transcribe({
        fname_inp: req.wavPath,
        model: req.modelPath,
        language: req.language,
        use_gpu: true,
        no_timestamps: true,
        no_prints: true,
        ...(req.prompt ? { prompt: req.prompt } : {})
      })
      process.parentPort.postMessage({ id: req.id, ok: true, text: extractTranscript(result) })
    } catch (err) {
      process.parentPort.postMessage({ id: req.id, ok: false, error: String(err) })
    }
  })()
})
```

- [ ] **Step 6: Write the failing test for the parent wrapper**

`src/main/voice/transcriber.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { createTranscriber, type ChildLike } from './transcriber'

class FakeChild extends EventEmitter implements ChildLike {
  sent: { id: number; wavPath: string }[] = []
  postMessage(msg: unknown): void { this.sent.push(msg as { id: number; wavPath: string }) }
  kill(): boolean { this.emit('exit', 0); return true }
  reply(id: number, text: string) { this.emit('message', { id, ok: true, text }) }
  fail(id: number, error: string) { this.emit('message', { id, ok: false, error }) }
}

describe('createTranscriber', () => {
  it('forwards a request and resolves with the child text', async () => {
    const child = new FakeChild()
    const t = createTranscriber({ childPath: '/x', forkImpl: () => child })
    const p = t.transcribe({ wavPath: '/tmp/a.wav', modelPath: '/m.bin', language: 'sr' })
    expect(child.sent[0].wavPath).toBe('/tmp/a.wav')
    child.reply(child.sent[0].id, 'prebaci na grid')
    await expect(p).resolves.toBe('prebaci na grid')
  })
  it('rejects when the child reports an error', async () => {
    const child = new FakeChild()
    const t = createTranscriber({ childPath: '/x', forkImpl: () => child })
    const p = t.transcribe({ wavPath: '/a.wav', modelPath: '/m.bin', language: 'sr' })
    child.fail(child.sent[0].id, 'model load failed')
    await expect(p).rejects.toThrow(/model load failed/)
  })
  it('serializes concurrent requests (one in flight)', async () => {
    const child = new FakeChild()
    const t = createTranscriber({ childPath: '/x', forkImpl: () => child })
    const p1 = t.transcribe({ wavPath: '/1.wav', modelPath: '/m.bin', language: 'sr' })
    const p2 = t.transcribe({ wavPath: '/2.wav', modelPath: '/m.bin', language: 'sr' })
    expect(child.sent).toHaveLength(1)
    child.reply(child.sent[0].id, 'one')
    await expect(p1).resolves.toBe('one')
    expect(child.sent).toHaveLength(2)
    child.reply(child.sent[1].id, 'two')
    await expect(p2).resolves.toBe('two')
  })
  it('child exit rejects the pending request and respawns on next call', async () => {
    const children: FakeChild[] = []
    const forkImpl = vi.fn(() => { const c = new FakeChild(); children.push(c); return c })
    const t = createTranscriber({ childPath: '/x', forkImpl })
    const p = t.transcribe({ wavPath: '/1.wav', modelPath: '/m.bin', language: 'sr' })
    children[0].emit('exit', 1)
    await expect(p).rejects.toThrow(/exited/)
    const p2 = t.transcribe({ wavPath: '/2.wav', modelPath: '/m.bin', language: 'sr' })
    expect(forkImpl).toHaveBeenCalledTimes(2)
    children[1].reply(children[1].sent[0].id, 'ok')
    await expect(p2).resolves.toBe('ok')
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/main/voice/transcriber.test.ts`
Expected: FAIL — `Cannot find module './transcriber'`

- [ ] **Step 8: Implement the parent wrapper**

`src/main/voice/transcriber.ts`:

```ts
// Parent-side handle on the transcriber utilityProcess. One request in
// flight at a time (whisper saturates the machine anyway); a dead child is
// respawned lazily on the next request. forkImpl is injectable for tests.
import { utilityProcess } from 'electron'

export interface ChildLike {
  postMessage(msg: unknown): void
  on(event: 'message', cb: (msg: unknown) => void): unknown
  on(event: 'exit', cb: (code: number) => void): unknown
  kill(): boolean
}

interface Pending { resolve: (text: string) => void; reject: (err: Error) => void }

export function createTranscriber(opts: { childPath: string; forkImpl?: (path: string) => ChildLike }) {
  const fork = opts.forkImpl ?? ((p: string) => utilityProcess.fork(p) as unknown as ChildLike)
  let child: ChildLike | null = null
  let nextId = 1
  const pending = new Map<number, Pending>()
  let chain: Promise<unknown> = Promise.resolve()

  const ensureChild = (): ChildLike => {
    if (child) return child
    const c = fork(opts.childPath)
    c.on('message', (raw) => {
      const msg = raw as { id: number; ok: boolean; text?: string; error?: string }
      // utilityProcess delivers { data } envelopes; the fake delivers flat.
      const m = (msg as unknown as { data?: typeof msg }).data ?? msg
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.text ?? '')
      else p.reject(new Error(m.error ?? 'transcription failed'))
    })
    c.on('exit', () => {
      child = null
      for (const [id, p] of pending) { pending.delete(id); p.reject(new Error('transcriber process exited')) }
    })
    child = c
    return c
  }

  const transcribe = (req: { wavPath: string; modelPath: string; language: string; prompt?: string }, timeoutMs = 60000): Promise<string> => {
    const run = () => new Promise<string>((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('transcription timed out'))
      }, timeoutMs)
      pending.set(id, {
        resolve: (t) => { clearTimeout(timer); resolve(t) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })
      ensureChild().postMessage({ id, ...req })
    })
    const result = chain.then(run, run)
    chain = result.catch(() => undefined)
    return result
  }

  return {
    transcribe,
    dispose: () => { child?.kill(); child = null }
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/main/voice/transcriber.test.ts src/main/voice/transcribeResult.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 10: Add the second main entry to electron.vite.config.ts**

Replace the `main:` line with:

```ts
  main: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          transcriberChild: resolve('src/main/voice/transcriberChild.ts')
        }
      }
    }
  },
```

- [ ] **Step 11: Build to verify both entries emit**

Run: `npm run build && ls out/main/`
Expected: `index.js` and `transcriberChild.js` both present.

- [ ] **Step 12: Typecheck and commit**

```bash
npm run typecheck
git add package.json package-lock.json electron.vite.config.ts src/main/voice/transcribeResult.ts src/main/voice/transcribeResult.test.ts src/main/voice/transcriberChild.ts src/main/voice/transcriber.ts src/main/voice/transcriber.test.ts
git commit -m "feat(voice): whisper transcriber in a utilityProcess"
```

---

### Task 10: Command executor — plan + delegate runner (renderer)

**Files:**
- Create: `src/renderer/src/voice/executor.ts`
- Create: `src/renderer/src/voice/executor.test.ts`
- Create: `src/renderer/src/voice/run.ts`
- Create: `src/renderer/src/voice/run.test.ts`

- [ ] **Step 1: Write the failing executor test**

`src/renderer/src/voice/executor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { planCommand } from './executor'
import {
  createInitialState, addGroup, addFeature, addTerminal, hideTerminal,
  toggleFeatureViewMode
} from '../store'
import type { VoiceCommand } from '@shared/voice'

function fixture() {
  let s = createInitialState()
  s = addGroup(s, 'mappit', '/code/mappit')
  const gid = s.workspace.groups[0].id
  s = addFeature(s, gid, 'file-panes')
  s = addFeature(s, gid, 'voice')
  const f1 = s.workspace.groups[0].features[0]
  const f2 = s.workspace.groups[0].features[1]
  s = addTerminal(s, f1.id, { name: 'claude', kind: 'claude' })
  s = addTerminal(s, f1.id, { name: 'shell' })
  return { s, f1: f1.id, f2: f2.id, t1: s.workspace.groups[0].features[0].terminals[0].id, t2: s.workspace.groups[0].features[0].terminals[1].id }
}
const cmd = (c: Partial<VoiceCommand> & { action: VoiceCommand['action'] }): VoiceCommand =>
  ({ confidence: 'high', ...c })

describe('planCommand — immediate actions', () => {
  it('switch_feature → run setActiveFeature, startIds = first visible terminal', () => {
    const { s, f1, t1 } = fixture()
    const p = planCommand(cmd({ action: 'switch_feature', featureId: f1 }), s)
    if (p.type !== 'run') throw new Error('expected run, got ' + p.type)
    expect(p.descriptor.startIds).toEqual([t1])
    expect(p.descriptor.run(s).activeFeatureId).toBe(f1)
    expect(p.descriptor.toast).toContain('file-panes')
  })
  it('toggle_grid defaults to the active feature and notes restored hidden terminals', () => {
    let { s, t2 } = fixture()
    s = hideTerminal(s, t2)
    const p = planCommand(cmd({ action: 'toggle_grid' }), s)
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.toast).toContain('restored')
    const after = p.descriptor.run(s)
    expect(after.workspace.groups[0].features[0].viewMode).toBe('grid')
  })
  it('toggle_grid leaving grid has no restored note', () => {
    let { s, f1 } = fixture()
    s = toggleFeatureViewMode(s, f1) // now grid
    const p = planCommand(cmd({ action: 'toggle_grid', featureId: f1 }), s)
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.toast).not.toContain('restored')
  })
  it('switch_tab on a hidden terminal un-hides it (showTerminal)', () => {
    let { s, t2 } = fixture()
    s = hideTerminal(s, t2)
    const p = planCommand(cmd({ action: 'switch_tab', terminalId: t2 }), s)
    if (p.type !== 'run') throw new Error('expected run')
    const after = p.descriptor.run(s)
    expect(after.hidden).not.toContain(t2)
    expect(after.activeTerminalId).toBe(t2)
    expect(p.descriptor.startIds).toEqual([t2])
  })
  it('set_grid_style requires a gridStyle', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'set_grid_style' }), s).type).toBe('error')
    const p = planCommand(cmd({ action: 'set_grid_style', gridStyle: 'cols' }), s)
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.run(s).workspace.groups[0].features[0].gridStyle).toBe('cols')
  })
  it('hide_terminal defaults to the active terminal', () => {
    const { s, t2 } = fixture() // addTerminal activates the last-added → t2 active
    const p = planCommand(cmd({ action: 'hide_terminal' }), s)
    if (p.type !== 'run') throw new Error('expected run')
    expect(p.descriptor.run(s).hidden).toContain(t2)
  })
})

describe('planCommand — confirm actions', () => {
  it('add_terminal defaults kind=claude, feature=active, carries the prompt editable', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'add_terminal', prompt: 'sredi testove' }), s)
    if (p.type !== 'confirm') throw new Error('expected confirm')
    expect(p.editablePrompt).toBe('sredi testove')
    expect(p.descriptor).toMatchObject({ type: 'addTerminal', featureId: f1, kind: 'claude', prompt: 'sredi testove' })
  })
  it('close_terminal → confirm with closeTerminal descriptor', () => {
    const { s, t2 } = fixture()
    const p = planCommand(cmd({ action: 'close_terminal', terminalId: t2 }), s)
    if (p.type !== 'confirm') throw new Error('expected confirm')
    expect(p.descriptor).toEqual({ type: 'closeTerminal', terminalId: t2 })
    expect(p.summary).toContain('shell')
  })
  it('rename_feature → confirm with a pure state descriptor', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'rename_feature', featureId: f1, name: 'panes-v2' }), s)
    if (p.type !== 'confirm') throw new Error('expected confirm')
    if (p.descriptor.type !== 'state') throw new Error('expected state descriptor')
    expect(p.descriptor.run(s).workspace.groups[0].features[0].name).toBe('panes-v2')
  })
  it('rename_terminal without a name → error', () => {
    const { s, t1 } = fixture()
    expect(planCommand(cmd({ action: 'rename_terminal', terminalId: t1 }), s).type).toBe('error')
  })
  it('low confidence downgrades an immediate action to confirm', () => {
    const { s, f1 } = fixture()
    const p = planCommand(cmd({ action: 'switch_feature', featureId: f1, confidence: 'low' }), s)
    expect(p.type).toBe('confirm')
  })
})

describe('planCommand — invalid input', () => {
  it('unknown → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'unknown' }), s).type).toBe('error')
  })
  it('stale/wrong ids → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'switch_feature', featureId: 'gone' }), s).type).toBe('error')
    expect(planCommand(cmd({ action: 'switch_tab', terminalId: 'gone' }), s).type).toBe('error')
  })
  it('switch_feature without featureId → error', () => {
    const { s } = fixture()
    expect(planCommand(cmd({ action: 'switch_feature' }), s).type).toBe('error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: FAIL — `Cannot find module './executor'`

- [ ] **Step 3: Implement the executor**

`src/renderer/src/voice/executor.ts`:

```ts
// VoiceCommand + live AppState → an execution plan. Pure module: no IPC, no
// effects. Three plan shapes:
//   run     — safe action, applied immediately with a toast
//   confirm — needs the overlay (creates/destroys something, free-text
//             payload, or the LLM flagged low confidence)
//   error   — invalid/unknown/stale — the overlay shows the transcript
// close_terminal/add_terminal yield DELEGATE descriptors (run.ts routes them
// through App's effectful handlers); everything else is a pure state run.
import type { AppState } from '../store'
import {
  setActiveFeature, toggleFeatureViewMode, setActiveTerminal, setFeatureGridStyle,
  hideTerminal, showTerminal, renameFeature, renameTerminal, getTerminalById
} from '../store'
import type { Feature, TerminalKind } from '@shared/types'
import type { VoiceCommand } from '@shared/voice'

export type StateDescriptor = {
  type: 'state'
  run: (s: AppState) => AppState
  toast: string
  // Terminal ids to markStarted() BEFORE apply — mirrors how existing handlers
  // gate spawning (see App.tsx onSelectTerminal / cycleTab).
  startIds?: string[]
}
export type ExecDescriptor =
  | StateDescriptor
  | { type: 'closeTerminal'; terminalId: string }
  | { type: 'addTerminal'; featureId: string; kind: TerminalKind; name?: string; prompt?: string }

export type ExecPlan =
  | { type: 'run'; descriptor: StateDescriptor }
  | { type: 'confirm'; summary: string; editablePrompt?: string; descriptor: ExecDescriptor }
  | { type: 'error'; message: string }

const findFeature = (s: AppState, id: string | undefined): Feature | null =>
  id ? s.workspace.groups.flatMap((g) => g.features).find((f) => f.id === id) ?? null : null

const err = (message: string): ExecPlan => ({ type: 'error', message })

export function planCommand(cmd: VoiceCommand, s: AppState): ExecPlan {
  const plan = planHigh(cmd, s)
  // Low LLM confidence: never run silently — show what was understood first.
  if (cmd.confidence === 'low' && plan.type === 'run') {
    return { type: 'confirm', summary: plan.descriptor.toast, descriptor: plan.descriptor }
  }
  return plan
}

function planHigh(cmd: VoiceCommand, s: AppState): ExecPlan {
  switch (cmd.action) {
    case 'switch_feature': {
      const f = findFeature(s, cmd.featureId)
      if (!f) return err('Feature not found — try again')
      const first = f.terminals.find((t) => !s.hidden.includes(t.id)) ?? f.terminals[0]
      return {
        type: 'run',
        descriptor: {
          type: 'state',
          run: (st) => setActiveFeature(st, f.id),
          toast: `→ ${f.name}`,
          ...(first ? { startIds: [first.id] } : {})
        }
      }
    }
    case 'toggle_grid': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('No feature to toggle')
      const entering = (f.viewMode ?? 'tabs') === 'tabs'
      const hadHidden = f.terminals.some((t) => s.hidden.includes(t.id))
      const note = entering && hadHidden ? ' (hidden terminals restored)' : ''
      return {
        type: 'run',
        descriptor: {
          type: 'state',
          run: (st) => toggleFeatureViewMode(st, f.id),
          toast: `${entering ? 'Grid' : 'Tabs'}: ${f.name}${note}`
        }
      }
    }
    case 'switch_tab': {
      const t = cmd.terminalId ? getTerminalById(s, cmd.terminalId) : null
      if (!t) return err('Terminal not found — try again')
      const hidden = s.hidden.includes(t.id)
      return {
        type: 'run',
        descriptor: {
          type: 'state',
          run: (st) => (hidden ? showTerminal(st, t.id) : setActiveTerminal(st, t.id)),
          toast: `→ ${t.name}`,
          startIds: [t.id]
        }
      }
    }
    case 'set_grid_style': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('No feature selected')
      if (!cmd.gridStyle) return err('No grid style understood')
      const style = cmd.gridStyle
      return {
        type: 'run',
        descriptor: { type: 'state', run: (st) => setFeatureGridStyle(st, f.id, style), toast: `Grid style: ${style}` }
      }
    }
    case 'hide_terminal': {
      const id = cmd.terminalId ?? s.activeTerminalId
      const t = id ? getTerminalById(s, id) : null
      if (!t) return err('Terminal not found — try again')
      return {
        type: 'run',
        descriptor: { type: 'state', run: (st) => hideTerminal(st, t.id), toast: `Hidden: ${t.name}` }
      }
    }
    case 'add_terminal': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('No feature to add the terminal to')
      const kind: TerminalKind = cmd.kind ?? 'claude'
      return {
        type: 'confirm',
        summary: `New ${kind} terminal in "${f.name}"`,
        ...(cmd.prompt ? { editablePrompt: cmd.prompt } : {}),
        descriptor: {
          type: 'addTerminal', featureId: f.id, kind,
          ...(cmd.name ? { name: cmd.name } : {}),
          ...(cmd.prompt ? { prompt: cmd.prompt } : {})
        }
      }
    }
    case 'close_terminal': {
      const id = cmd.terminalId ?? s.activeTerminalId
      const t = id ? getTerminalById(s, id) : null
      if (!t) return err('Terminal not found — try again')
      return {
        type: 'confirm',
        summary: `Close terminal "${t.name}"`,
        descriptor: { type: 'closeTerminal', terminalId: t.id }
      }
    }
    case 'rename_feature': {
      const f = findFeature(s, cmd.featureId ?? s.activeFeatureId ?? undefined)
      if (!f) return err('Feature not found — try again')
      if (!cmd.name) return err('No new name understood')
      const name = cmd.name
      return {
        type: 'confirm',
        summary: `Rename feature "${f.name}" → "${name}"`,
        descriptor: { type: 'state', run: (st) => renameFeature(st, f.id, name), toast: `Renamed: ${name}` }
      }
    }
    case 'rename_terminal': {
      const id = cmd.terminalId ?? s.activeTerminalId
      const t = id ? getTerminalById(s, id) : null
      if (!t) return err('Terminal not found — try again')
      if (!cmd.name) return err('No new name understood')
      const name = cmd.name
      return {
        type: 'confirm',
        summary: `Rename terminal "${t.name}" → "${name}"`,
        descriptor: { type: 'state', run: (st) => renameTerminal(st, t.id, name), toast: `Renamed: ${name}` }
      }
    }
    case 'unknown':
      return err("Didn't understand the command")
  }
}
```

- [ ] **Step 4: Run executor tests**

Run: `npx vitest run src/renderer/src/voice/executor.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Write the failing run.ts test**

`src/renderer/src/voice/run.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { runDescriptor } from './run'
import { createInitialState, addGroup, addFeature, addTerminal, type AppState } from '../store'

function fixture(withReviewer = false) {
  let s = createInitialState()
  s = addGroup(s, 'p', '/p')
  const gid = s.workspace.groups[0].id
  s = addFeature(s, gid, 'f')
  const fid = s.workspace.groups[0].features[0].id
  s = addTerminal(s, fid, { name: 'origin', kind: 'claude' })
  const originId = s.workspace.groups[0].features[0].terminals[0].id
  if (withReviewer) {
    s = addTerminal(s, fid, {
      name: 'reviewer', kind: 'claude',
      review: { originTerminalId: originId, phase: 'impl', round: 1, maxRounds: 3, reviewDir: '/tmp/r' }
    })
  }
  const ids = s.workspace.groups[0].features[0].terminals.map((t) => t.id)
  return { s, fid, ids }
}

const deps = (s: AppState) => ({
  state: s,
  apply: vi.fn(),
  markStarted: vi.fn(),
  stopReviewLoop: vi.fn(),
  launchAgent: vi.fn()
})

describe('runDescriptor', () => {
  it('state: marks startIds then applies', () => {
    const { s } = fixture()
    const d = deps(s)
    const run = (st: AppState) => st
    runDescriptor({ type: 'state', run, toast: 'x', startIds: ['a', 'b'] }, d)
    expect(d.markStarted.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(d.apply).toHaveBeenCalledWith(run)
  })
  it('closeTerminal on a REVIEWER terminal → stopReviewLoop, never removeTerminal', () => {
    const { s, ids } = fixture(true)
    const d = deps(s)
    runDescriptor({ type: 'closeTerminal', terminalId: ids[1] }, d)
    expect(d.stopReviewLoop).toHaveBeenCalledWith(ids[1])
    expect(d.apply).not.toHaveBeenCalled()
  })
  it('closeTerminal on a plain terminal → apply(removeTerminal)', () => {
    const { s, ids } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'closeTerminal', terminalId: ids[0] }, d)
    expect(d.stopReviewLoop).not.toHaveBeenCalled()
    expect(d.apply).toHaveBeenCalledTimes(1)
    const fn = d.apply.mock.calls[0][0] as (st: AppState) => AppState
    const after = fn(s)
    expect(after.workspace.groups[0].features[0].terminals.map((t) => t.id)).not.toContain(ids[0])
  })
  it('addTerminal agent kind → launchAgent with prompt/name', () => {
    const { s, fid } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'addTerminal', featureId: fid, kind: 'claude', prompt: 'sredi testove' }, d)
    expect(d.launchAgent).toHaveBeenCalledWith(fid, 'claude', { prompt: 'sredi testove' })
    expect(d.apply).not.toHaveBeenCalled()
  })
  it('addTerminal shell kind → apply(addTerminal) with the prompt as startupCommand', () => {
    const { s, fid } = fixture()
    const d = deps(s)
    runDescriptor({ type: 'addTerminal', featureId: fid, kind: 'shell', prompt: 'npm test' }, d)
    expect(d.launchAgent).not.toHaveBeenCalled()
    const fn = d.apply.mock.calls[0][0] as (st: AppState) => AppState
    const after = fn(s)
    const added = after.workspace.groups[0].features[0].terminals.at(-1)
    expect(added?.startupCommand).toBe('npm test')
    expect(added?.name).toBe('shell')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/voice/run.test.ts`
Expected: FAIL — `Cannot find module './run'`

- [ ] **Step 7: Implement run.ts**

`src/renderer/src/voice/run.ts`:

```ts
// Executes an ExecDescriptor through App-provided dependencies. This is the
// delegation seam the spec requires: closeTerminal mirrors App's
// onDeleteTerminal branch (reviewer → review.stopLoop, else removeTerminal),
// addTerminal goes through the extracted launchAgent (sessionId pinning,
// codex session capture) — never reimplemented here.
import type { AppState } from '../store'
import { addTerminal, getTerminalById, removeTerminal } from '../store'
import type { AgentKind } from '../agents'
import type { ExecDescriptor } from './executor'

export interface RunDeps {
  state: AppState
  apply: (fn: (s: AppState) => AppState) => void
  markStarted: (id: string) => void
  stopReviewLoop: (terminalId: string) => void
  launchAgent: (featureId: string, kind: AgentKind, opts?: { prompt?: string; name?: string }) => void
}

export function runDescriptor(d: ExecDescriptor, deps: RunDeps): void {
  if (d.type === 'state') {
    d.startIds?.forEach(deps.markStarted)
    deps.apply(d.run)
    return
  }
  if (d.type === 'closeTerminal') {
    const t = getTerminalById(deps.state, d.terminalId)
    if (t?.review) deps.stopReviewLoop(d.terminalId)
    else deps.apply((s) => removeTerminal(s, d.terminalId))
    return
  }
  // addTerminal
  if (d.kind === 'shell') {
    deps.apply((s) => addTerminal(s, d.featureId, {
      name: d.name ?? 'shell',
      ...(d.prompt ? { startupCommand: d.prompt } : {})
    }))
    return
  }
  deps.launchAgent(d.featureId, d.kind, {
    ...(d.prompt ? { prompt: d.prompt } : {}),
    ...(d.name ? { name: d.name } : {})
  })
}
```

- [ ] **Step 8: Run all voice renderer tests**

Run: `npx vitest run src/renderer/src/voice/`
Expected: PASS (executor 14, run 5, dsp 9, snapshot 3)

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/voice/executor.ts src/renderer/src/voice/executor.test.ts src/renderer/src/voice/run.ts src/renderer/src/voice/run.test.ts
git commit -m "feat(voice): command executor with delegate descriptors"
```

---

### Task 11: Voice UI state machine (renderer)

**Files:**
- Create: `src/renderer/src/voice/machine.ts`
- Create: `src/renderer/src/voice/machine.test.ts`

- [ ] **Step 1: Write the failing test**

`src/renderer/src/voice/machine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reduceVoice, IDLE, type VoiceUiState } from './machine'
import type { ExecDescriptor } from './executor'

const desc: ExecDescriptor = { type: 'closeTerminal', terminalId: 't1' }

describe('reduceVoice', () => {
  it('idle → listening on listen', () => {
    expect(reduceVoice(IDLE, { type: 'listen' })).toEqual({ kind: 'listening' })
  })
  it('listening → processing on audio-sent', () => {
    expect(reduceVoice({ kind: 'listening' }, { type: 'audio-sent' }))
      .toEqual({ kind: 'processing', label: 'Transcribing…' })
  })
  it('voice:state events update the processing label / download progress', () => {
    const p: VoiceUiState = { kind: 'processing', label: 'Transcribing…' }
    expect(reduceVoice(p, { type: 'state', ev: { phase: 'downloading-model', received: 5, total: 10 } }))
      .toEqual({ kind: 'downloading', received: 5, total: 10 })
    expect(reduceVoice(p, { type: 'state', ev: { phase: 'parsing', transcript: 'prebaci' } }))
      .toEqual({ kind: 'processing', label: 'Parsing…', transcript: 'prebaci' })
    expect(reduceVoice(p, { type: 'state', ev: { phase: 'error', message: 'boom', transcript: 'x' } }))
      .toEqual({ kind: 'error', message: 'boom', transcript: 'x' })
  })
  it('plan run → toast; plan confirm → confirm; plan error → error', () => {
    const p: VoiceUiState = { kind: 'processing', label: 'Parsing…' }
    expect(reduceVoice(p, { type: 'executed', toast: '→ file-panes' })).toEqual({ kind: 'toast', text: '→ file-panes' })
    expect(reduceVoice(p, {
      type: 'confirm', transcript: 'zatvori', summary: 'Close terminal "shell"', descriptor: desc
    })).toEqual({ kind: 'confirm', transcript: 'zatvori', summary: 'Close terminal "shell"', descriptor: desc })
    expect(reduceVoice(p, { type: 'plan-error', message: 'nope', transcript: 'zzz' }))
      .toEqual({ kind: 'error', message: 'nope', transcript: 'zzz' })
  })
  it('confirm → toast on executed (user pressed Enter)', () => {
    const c: VoiceUiState = { kind: 'confirm', transcript: 't', summary: 's', descriptor: desc }
    expect(reduceVoice(c, { type: 'executed', toast: 'Terminal closed' }))
      .toEqual({ kind: 'toast', text: 'Terminal closed' })
  })
  it('mic-error is reachable from idle (getUserMedia rejected)', () => {
    expect(reduceVoice(IDLE, { type: 'mic-error', message: 'Microphone unavailable' }))
      .toEqual({ kind: 'error', message: 'Microphone unavailable' })
  })
  it('dismiss returns to idle from any state', () => {
    for (const st of [
      { kind: 'listening' }, { kind: 'toast', text: 'x' },
      { kind: 'error', message: 'm' }, { kind: 'confirm', transcript: 't', summary: 's', descriptor: desc }
    ] as VoiceUiState[]) {
      expect(reduceVoice(st, { type: 'dismiss' })).toEqual(IDLE)
    }
  })
  it('stray NON-ERROR events in idle stay idle', () => {
    expect(reduceVoice(IDLE, { type: 'state', ev: { phase: 'transcribing' } })).toEqual(IDLE)
    expect(reduceVoice(IDLE, { type: 'executed', toast: 'x' })).toEqual(IDLE)
  })
  it('error phase surfaces even from idle (startup shortcut warning)', () => {
    expect(reduceVoice(IDLE, { type: 'state', ev: { phase: 'error', message: 'shortcut taken' } }))
      .toEqual({ kind: 'error', message: 'shortcut taken' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/voice/machine.test.ts`
Expected: FAIL — `Cannot find module './machine'`

- [ ] **Step 3: Implement the reducer**

`src/renderer/src/voice/machine.ts`:

```ts
// Pure UI state machine for the voice overlay. Side effects (recorder, IPC,
// executing plans) live in useVoice — this reducer only answers "what is on
// screen". Errors ALWAYS surface (the startup "shortcut taken" warning
// arrives while idle); other stray events outside an active flow are ignored
// (main gen-guards canceled generations, so progress events cannot resurrect
// a canceled flow anyway).
import type { VoiceStateEvent } from '@shared/voice'
import type { ExecDescriptor } from './executor'

export type VoiceUiState =
  | { kind: 'idle' }
  | { kind: 'listening' }
  | { kind: 'processing'; label: string; transcript?: string }
  | { kind: 'downloading'; received: number; total: number | null }
  | { kind: 'confirm'; transcript: string; summary: string; descriptor: ExecDescriptor; editablePrompt?: string }
  | { kind: 'toast'; text: string }
  | { kind: 'error'; message: string; transcript?: string }

export type VoiceUiEvent =
  | { type: 'listen' }
  | { type: 'audio-sent' }
  | { type: 'state'; ev: VoiceStateEvent }
  | { type: 'executed'; toast: string }
  | { type: 'confirm'; transcript: string; summary: string; descriptor: ExecDescriptor; editablePrompt?: string }
  | { type: 'plan-error'; message: string; transcript?: string }
  | { type: 'mic-error'; message: string }
  | { type: 'dismiss' }

export const IDLE: VoiceUiState = { kind: 'idle' }

const active = (s: VoiceUiState) => s.kind === 'processing' || s.kind === 'downloading'

export function reduceVoice(s: VoiceUiState, e: VoiceUiEvent): VoiceUiState {
  switch (e.type) {
    case 'listen': return { kind: 'listening' }
    case 'dismiss': return IDLE
    case 'mic-error': return { kind: 'error', message: e.message }
    case 'audio-sent': return s.kind === 'listening' ? { kind: 'processing', label: 'Transcribing…' } : s
    case 'state': {
      if (e.ev.phase === 'error') {
        return { kind: 'error', message: e.ev.message, ...(e.ev.transcript ? { transcript: e.ev.transcript } : {}) }
      }
      if (!active(s)) return s
      switch (e.ev.phase) {
        case 'transcribing': return { kind: 'processing', label: 'Transcribing…' }
        case 'parsing': return { kind: 'processing', label: 'Parsing…', transcript: e.ev.transcript }
        case 'downloading-model': return { kind: 'downloading', received: e.ev.received, total: e.ev.total }
      }
      return s
    }
    // executed also fires from confirm — the user pressed Enter in the modal.
    case 'executed': return active(s) || s.kind === 'confirm' ? { kind: 'toast', text: e.toast } : s
    case 'confirm': return active(s)
      ? { kind: 'confirm', transcript: e.transcript, summary: e.summary, descriptor: e.descriptor, ...(e.editablePrompt ? { editablePrompt: e.editablePrompt } : {}) }
      : s
    case 'plan-error': return active(s) ? { kind: 'error', message: e.message, ...(e.transcript ? { transcript: e.transcript } : {}) } : s
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/voice/machine.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/voice/machine.ts src/renderer/src/voice/machine.test.ts
git commit -m "feat(voice): overlay ui state machine"
```

---

### Task 12: Recorder (renderer, AudioWorklet)

**Files:**
- Create: `src/renderer/src/voice/recorder.ts`

No unit test — Web Audio does not exist in jsdom; the pure logic (downsample,
silence) is already covered by Task 4. Manual verification happens in Task 17.

- [ ] **Step 1: Implement the recorder**

`src/renderer/src/voice/recorder.ts`:

```ts
// Microphone capture: getUserMedia → AudioWorklet (loaded from a Blob URL so
// no extra build entry is needed) → Float32 chunks accumulate here, with the
// SilenceTracker deciding auto-stop. stop() returns 16 kHz mono PCM ready for
// whisper; cancel() tears everything down and discards the audio.
import { concatFloat32, downsample, SilenceTracker } from './dsp'

const WORKLET_SOURCE = `
class VoiceCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('voice-capture', VoiceCapture)
`

export interface RecorderHandle {
  // Resolves with 16 kHz mono PCM, or null when almost nothing was recorded.
  stop(): Promise<Float32Array | null>
  cancel(): void
}

export async function startRecording(opts: { onAutoStop: () => void }): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  })
  const ctx = new AudioContext()
  const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
  try {
    await ctx.audioWorklet.addModule(workletUrl)
  } finally {
    URL.revokeObjectURL(workletUrl)
  }

  const chunks: Float32Array[] = []
  const tracker = new SilenceTracker({ sampleRate: ctx.sampleRate })
  let done = false
  let autoStopFired = false

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'voice-capture')
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (done) return
    chunks.push(e.data)
    if (!autoStopFired && tracker.push(e.data) === 'stop') {
      autoStopFired = true
      opts.onAutoStop()
    }
  }
  source.connect(node)
  // No connection to ctx.destination — capture only, no monitoring loopback.

  const teardown = () => {
    done = true
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }

  return {
    stop: async () => {
      const sampleRate = ctx.sampleRate
      teardown()
      const pcm = downsample(concatFloat32(chunks), sampleRate, 16000)
      // Under ~0.4s is a misfire (key bounce, instant second press) — drop it.
      return pcm.length < 16000 * 0.4 ? null : pcm
    },
    cancel: teardown
  }
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/src/voice/recorder.ts
git commit -m "feat(voice): audio worklet recorder with silence auto-stop"
```

---

### Task 13: VoiceOverlay component (renderer)

**Files:**
- Create: `src/renderer/src/components/VoiceOverlay.tsx`
- Create: `src/renderer/src/components/VoiceOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/renderer/src/components/VoiceOverlay.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VoiceOverlay } from './VoiceOverlay'
import type { VoiceUiState } from '../voice/machine'

const noop = () => {}
const renderState = (state: VoiceUiState, onConfirm = vi.fn(), onCancel = vi.fn()) => {
  render(<VoiceOverlay state={state} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('VoiceOverlay', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<VoiceOverlay state={{ kind: 'idle' }} onConfirm={noop} onCancel={noop} />)
    expect(container.firstChild).toBeNull()
  })
  it('listening shows the hint', () => {
    renderState({ kind: 'listening' })
    expect(screen.getByText(/Listening/)).toBeInTheDocument()
  })
  it('processing shows label and transcript', () => {
    renderState({ kind: 'processing', label: 'Parsing…', transcript: 'prebaci na grid' })
    expect(screen.getByText('Parsing…')).toBeInTheDocument()
    expect(screen.getByText(/prebaci na grid/)).toBeInTheDocument()
  })
  it('downloading shows progress percentage', () => {
    renderState({ kind: 'downloading', received: 250, total: 1000 })
    expect(screen.getByText(/25%/)).toBeInTheDocument()
  })
  it('confirm: Enter confirms with the edited prompt, Escape cancels', () => {
    const { onConfirm, onCancel } = renderState({
      kind: 'confirm', transcript: 'dodaj terminal', summary: 'New claude terminal in "file-panes"',
      descriptor: { type: 'addTerminal', featureId: 'f1', kind: 'claude', prompt: 'stari' },
      editablePrompt: 'stari'
    })
    expect(screen.getByText(/New claude terminal/)).toBeInTheDocument()
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'novi prompt' } })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith('novi prompt')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
  it('confirm without editablePrompt has no textarea and confirms with undefined', () => {
    const { onConfirm } = renderState({
      kind: 'confirm', transcript: 'zatvori', summary: 'Close terminal "shell"',
      descriptor: { type: 'closeTerminal', terminalId: 't1' }
    })
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith(undefined)
  })
  it('toast and error render their text with a dismiss button', () => {
    const { onCancel } = renderState({ kind: 'error', message: 'Groq request timed out', transcript: 'xyz' })
    expect(screen.getByText(/timed out/)).toBeInTheDocument()
    expect(screen.getByText(/xyz/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(onCancel).toHaveBeenCalled()
  })
  it('Escape cancels during processing (spec: Esc cancels at any stage)', () => {
    const { onCancel } = renderState({ kind: 'processing', label: 'Transcribing…' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/VoiceOverlay.test.tsx`
Expected: FAIL — `Cannot find module './VoiceOverlay'`

- [ ] **Step 3: Implement the component**

`src/renderer/src/components/VoiceOverlay.tsx`:

```tsx
// All voice UI in one component, switched on the machine state: a top pill
// while listening/processing, a centered modal for confirm (ConfirmDialog's
// pattern: window keydown in capture phase so Enter/Escape never leak into a
// focused terminal), and a bottom-right toast for results/errors (ExportToast
// placement).
import { useEffect, useRef, useState } from 'react'
import { SpinnerIcon } from './icons'
import type { VoiceUiState } from '../voice/machine'

export function VoiceOverlay({ state, onConfirm, onCancel }: {
  state: VoiceUiState
  onConfirm: (editedPrompt?: string) => void
  onCancel: () => void
}) {
  const isConfirm = state.kind === 'confirm'
  const hasPrompt = isConfirm && state.editablePrompt !== undefined
  const [prompt, setPrompt] = useState('')
  const promptRef = useRef('')
  useEffect(() => {
    if (isConfirm) { setPrompt(state.editablePrompt ?? ''); promptRef.current = state.editablePrompt ?? '' }
  }, [isConfirm]) // eslint-disable-line react-hooks/exhaustive-deps -- reset only when the confirm opens

  useEffect(() => {
    // Spec: Esc cancels at ANY stage — listening, processing, downloading,
    // confirm, even a lingering toast/error. Enter only confirms the modal.
    if (state.kind === 'idle') return
    const confirmable = state.kind === 'confirm'
    const withPrompt = confirmable && state.editablePrompt !== undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
      // Shift+Enter keeps inserting newlines into the prompt textarea.
      else if (e.key === 'Enter' && !e.shiftKey && confirmable) {
        e.preventDefault(); e.stopPropagation()
        onConfirm(withPrompt ? promptRef.current : undefined)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state.kind, isConfirm && state.editablePrompt, onConfirm, onCancel]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === 'idle') return null

  if (state.kind === 'listening' || state.kind === 'processing' || state.kind === 'downloading') {
    return (
      <div className="fixed left-1/2 top-3 z-[70] -translate-x-1/2 rounded-full border border-line bg-elevated px-4 py-2 text-sm text-fg shadow-xl shadow-black/50 flex items-center gap-2">
        {state.kind === 'listening' ? (
          <>
            <span className="h-2.5 w-2.5 rounded-full bg-danger animate-pulse" />
            <span>Listening… pause or press the shortcut to finish · Esc cancels</span>
          </>
        ) : state.kind === 'downloading' ? (
          <>
            <SpinnerIcon className="shrink-0 text-accent" />
            <span>Downloading voice model… {state.total ? `${Math.round((state.received / state.total) * 100)}%` : `${Math.round(state.received / 1e6)} MB`}</span>
          </>
        ) : (
          <>
            <SpinnerIcon className="shrink-0 text-accent" />
            <span>{state.label}</span>
            {state.transcript && <span className="text-fg-muted">“{state.transcript}”</span>}
          </>
        )}
      </div>
    )
  }

  if (state.kind === 'confirm') {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
        <div className="w-[28rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
          <p className="mb-1 text-xs text-fg-muted">“{state.transcript}”</p>
          <p className="mb-3 text-sm text-fg-bright">{state.summary}</p>
          {hasPrompt && (
            <textarea
              autoFocus
              rows={4}
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); promptRef.current = e.target.value }}
              className="mb-3 w-full resize-y rounded-md border border-line bg-panel p-2 text-sm text-fg outline-none focus:border-accent"
            />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors">Cancel (Esc)</button>
            <button onClick={() => onConfirm(hasPrompt ? prompt : undefined)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:opacity-90 transition">
              Run (Enter)
            </button>
          </div>
        </div>
      </div>
    )
  }

  // toast | error — bottom-right, ExportToast's spot.
  const isError = state.kind === 'error'
  return (
    <div role="status" aria-live="polite" className="fixed bottom-3 right-3 z-[70] w-80 max-w-[90vw] rounded-md border border-line bg-elevated px-3 py-2 text-sm shadow-xl shadow-black/50">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className={isError ? 'text-danger' : 'text-fg'}>{isError ? state.message : state.text}</span>
          {isError && state.transcript && <p className="mt-0.5 text-xs text-fg-muted">“{state.transcript}”</p>}
        </div>
        <button type="button" aria-label="Dismiss" onClick={onCancel} className="shrink-0 px-1 text-fg-muted transition hover:text-fg">✕</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/VoiceOverlay.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/VoiceOverlay.tsx src/renderer/src/components/VoiceOverlay.test.tsx
git commit -m "feat(voice): overlay component (pill, confirm modal, toast)"
```

---

### Task 14: Preload + BrainApi surface

**Files:**
- Modify: `src/shared/api.ts` (5 new methods at the end of `BrainApi`)
- Modify: `src/preload/index.ts` (implementations)

No new unit tests — preload follows the existing untested bridge pattern; the
contract is exercised end-to-end in Task 17.

- [ ] **Step 1: Extend BrainApi**

In `src/shared/api.ts`, add to the imports:

```ts
import type { VoiceResult, VoiceStateEvent, WorkspaceSnapshot } from './voice'
```

and add before the closing `}` of `interface BrainApi`:

```ts
  // Voice commands. onVoiceStart fires on the global shortcut (main side
  // focuses the window first); audio goes back as 16 kHz mono PCM plus the
  // names snapshot the intent LLM needs. cancelVoice invalidates any
  // in-flight transcription/parse (late results are dropped in main).
  onVoiceStart(cb: () => void): () => void
  sendVoiceAudio(pcm: Float32Array, snapshot: WorkspaceSnapshot): void
  onVoiceState(cb: (ev: VoiceStateEvent) => void): () => void
  onVoiceResult(cb: (r: VoiceResult) => void): () => void
  cancelVoice(): void
```

- [ ] **Step 2: Implement in preload**

In `src/preload/index.ts`, add to the imports:

```ts
import type { VoiceResult, VoiceStateEvent, WorkspaceSnapshot } from '../shared/voice'
```

and add before the closing `}` of `const api: BrainApi = {`:

```ts
  onVoiceStart: (cb) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.voiceStart, listener)
    return () => ipcRenderer.removeListener(IPC.voiceStart, listener)
  },
  sendVoiceAudio: (pcm: Float32Array, snapshot: WorkspaceSnapshot) =>
    ipcRenderer.send(IPC.voiceAudio, { pcm, snapshot }),
  onVoiceState: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: VoiceStateEvent) => cb(ev)
    ipcRenderer.on(IPC.voiceState, listener)
    return () => ipcRenderer.removeListener(IPC.voiceState, listener)
  },
  onVoiceResult: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, r: VoiceResult) => cb(r)
    ipcRenderer.on(IPC.voiceResult, listener)
    return () => ipcRenderer.removeListener(IPC.voiceResult, listener)
  },
  cancelVoice: () => ipcRenderer.send(IPC.voiceCancel)
```

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add src/shared/api.ts src/preload/index.ts
git commit -m "feat(voice): preload bridge for voice channels"
```

---

### Task 15: Main-process orchestration + bootstrap wiring

**Files:**
- Create: `src/main/voice/index.ts`
- Modify: `src/main/index.ts` (register after `registerIpc`)

Orchestration glues already-tested modules (config, models, wav, transcriber,
translit, intent) to Electron APIs (`globalShortcut`, `ipcMain`) — no unit
test; covered by the Task 17 manual checklist.

- [ ] **Step 1: Implement the orchestrator**

`src/main/voice/index.ts`:

```ts
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
import type { VoiceStateEvent, WorkspaceSnapshot } from '@shared/voice'
import { loadVoiceConfig } from './config'
import { ensureModel } from './models'
import { encodeWavPcm16 } from './wav'
import { toLatin } from './translit'
import { parseIntent, whisperInitialPrompt, VoiceIntentError } from './intent'
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

  if (!config.enabled) {
    // The sidebar mic button renders regardless of config — answer its audio
    // with a clear error instead of leaving the pill stuck on "Transcribing…".
    ipcMain.on(IPC.voiceAudio, () => sendState({ phase: 'error', message: 'Voice is disabled in voice.json' }))
    return { dispose: () => {} }
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
        let raw: string
        try {
          raw = await transcriber.transcribe({
            wavPath, modelPath, language: config.language,
            prompt: whisperInitialPrompt(p.snapshot)
          })
        } finally {
          void fsp.rm(wavPath, { force: true })
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
        const message = err instanceof VoiceIntentError ? err.message : `Voice command failed: ${String(err)}`
        sendState({ phase: 'error', message, ...(transcript ? { transcript } : {}) })
      }
    })()
  })

  ipcMain.on(IPC.voiceCancel, () => { gen++ })

  return {
    dispose: () => {
      globalShortcut.unregister(config.shortcut)
      transcriber.dispose()
    }
  }
}
```

- [ ] **Step 2: Wire into src/main/index.ts**

Add the import:

```ts
import { registerVoice } from './voice'
```

and inside `app.whenReady().then(() => { … })`, right after `createWindow()`:

```ts
  // Voice commands: global shortcut + transcribe/intent pipeline. Errors here
  // must never block app startup (missing model, bad config, …).
  void registerVoice({
    getWin: () => mainWindow,
    userDataDir: app.getPath('userData')
  }).catch((err) => console.error('voice registration failed:', err))
```

(Electron unregisters all global shortcuts automatically on quit — no extra
`will-quit` handling.)

- [ ] **Step 3: Typecheck, build, smoke-boot**

```bash
npm run typecheck
npm run build
npm run dev
```

Expected: app boots normally. Pressing Ctrl+Alt+Space focuses the window (the
renderer has no listener yet — nothing else happens). Ctrl+C to stop dev.

- [ ] **Step 4: Commit**

```bash
git add src/main/voice/index.ts src/main/index.ts
git commit -m "feat(voice): main-process pipeline + global shortcut"
```

---

### Task 16: Renderer glue — launchAgent prompt, useVoice hook, App + Sidebar wiring

**Files:**
- Modify: `src/renderer/src/agents.ts` (prompt-aware launch command)
- Create: `src/renderer/src/agents.test.ts`
- Create: `src/renderer/src/voice/useVoice.ts`
- Modify: `src/renderer/src/App.tsx` (launchAgent opts, hook, overlay)
- Modify: `src/renderer/src/components/Sidebar.tsx` (mic button)
- Modify: `src/renderer/src/components/Sidebar.test.tsx` (new prop in fixtures)

- [ ] **Step 1: Write the failing agents test**

`src/renderer/src/agents.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { agentLaunchCommandWithPrompt } from './agents'

describe('agentLaunchCommandWithPrompt', () => {
  it('appends a single-quoted prompt to the launch command', () => {
    expect(agentLaunchCommandWithPrompt('claude', 'sid-1', 'sredi testove'))
      .toBe(`claude --session-id sid-1 'sredi testove'`)
  })
  it('escapes single quotes in the prompt', () => {
    expect(agentLaunchCommandWithPrompt('codex', undefined, "fix 'all' tests"))
      .toBe(`codex 'fix '\\''all'\\'' tests'`)
  })
  it('no prompt → plain launch command', () => {
    expect(agentLaunchCommandWithPrompt('claude', undefined, undefined)).toBe('claude')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/agents.test.ts`
Expected: FAIL — `agentLaunchCommandWithPrompt` is not exported

- [ ] **Step 3: Implement in agents.ts**

Add to `src/renderer/src/agents.ts`, right after `agentLaunchCommand`:

```ts
// Fresh launch with an optional first message — the voice add_terminal path.
// Same quoting as agentContinueCommand: the prompt rides as ONE shell argument.
export function agentLaunchCommandWithPrompt(kind: AgentKind, sessionId?: string, prompt?: string): string {
  const base = agentLaunchCommand(kind, sessionId)
  return prompt ? `${base} ${shellSingleQuote(prompt)}` : base
}
```

Run: `npx vitest run src/renderer/src/agents.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Implement the useVoice hook**

`src/renderer/src/voice/useVoice.ts`:

```ts
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
```

- [ ] **Step 5: Wire App.tsx**

1. Extend `launchAgent` (App.tsx, currently `(featureId: string, kind: AgentKind)`) to:

```ts
  const launchAgent = (featureId: string, kind: AgentKind, opts?: { prompt?: string; name?: string }) => {
    const a = AGENTS[kind]
    const id = createId()
    // claude lets us pin the conversation id up front (--session-id), so a restart
    // resumes THIS terminal's session, not the cwd's most-recent one. codex can't,
    // so it launches plain and we detect its session id from the rollout it writes.
    const sessionId = kind === 'claude' ? createId() : undefined
    apply((s) => addTerminal(s, featureId, {
      id,
      name: opts?.name ?? a.defaultName,
      startupCommand: agentLaunchCommandWithPrompt(kind, sessionId, opts?.prompt),
      kind,
      sessionId
    }))
    if (kind === 'codex') {
      // …existing captureAgentSession block stays unchanged…
    }
  }
```

and switch the `agentLaunchCommand` import to also import `agentLaunchCommandWithPrompt` from `./agents`.

2. Below the `launchAgent` definition add:

```ts
  const voice = useVoice({
    state, apply, markStarted,
    stopReviewLoop: (id) => review.stopLoop(id),
    launchAgent
  })
```

with imports:

```ts
import { useVoice } from './voice/useVoice'
import { VoiceOverlay } from './components/VoiceOverlay'
```

3. In the JSX, next to `<ExportToast …/>`, render:

```tsx
      <VoiceOverlay state={voice.ui} onConfirm={voice.confirm} onCancel={voice.cancel} />
```

4. Pass `onVoice={voice.toggle}` to `<Sidebar …>`.

- [ ] **Step 6: Mic button in Sidebar**

In `src/renderer/src/components/Sidebar.tsx`: add `onVoice: () => void` to the
props type (next to `onAddGroup`/`onImport`) and a button in the footer div
(`className="p-2 border-t border-line flex gap-2"`), after the Import button:

```tsx
        <button aria-label="Voice command" title="Voice command (Ctrl+Alt+Space)" onClick={onVoice}
          className="rounded-md border border-dashed border-divider bg-transparent px-2 py-1 text-xs text-fg-muted outline-none transition hover:border-accent hover:text-accent">
          🎤
        </button>
```

In `src/renderer/src/components/Sidebar.test.tsx`: add `onVoice: () => {}` to
the props object(s) the tests pass to `<Sidebar>`.

- [ ] **Step 7: Run the full suite and typecheck**

```bash
npm run typecheck && npm test
```

Expected: all suites PASS (including the pre-existing ones).

- [ ] **Step 8: Manual smoke (first real end-to-end)**

Pre-req: `export GROQ_API_KEY=gsk_…` (free key from console.groq.com), then `npm run dev`.

1. Press `Ctrl+Alt+Space` → "Listening…" pill appears (first ever use: model download progress appears first — ~1.1 GB).
2. Say **"otvori grid"**, pause → pill shows Transcribing → Parsing → the active feature toggles to grid + toast.
3. Click the 🎤 sidebar button → same flow.
4. Say **"dodaj claude terminal sa promptom sredi testove"** → confirm modal with editable prompt → Enter → claude terminal launches with the prompt.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/agents.ts src/renderer/src/agents.test.ts src/renderer/src/voice/useVoice.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(voice): renderer glue — useVoice hook, overlay, mic button"
```

---

### Task 17: Packaging, model benchmark, manual E2E checklist

**Files:**
- Modify: `package.json` (asarUnpack)
- Create: `scripts/voice-bench.mjs`
- Create: `assets/voice-fixtures/PHRASES.md`

- [ ] **Step 1: asarUnpack the whisper addon**

In `package.json` → `build.asarUnpack`, add the addon (native `.node` files
cannot load from inside asar — same reason node-pty is listed):

```json
    "asarUnpack": [
      "**/node_modules/node-pty/**",
      "**/node_modules/@kutalia/whisper-node-addon/**"
    ],
```

Then verify the prebuilds really ship (spec requirement): `ls node_modules/@kutalia/whisper-node-addon` and confirm a `prebuilds/` (or platform `.node`) directory exists for linux-x64. If it does NOT, change the `rebuild` script to `electron-rebuild -f -w node-pty,@kutalia/whisper-node-addon`.

- [ ] **Step 2: Record benchmark fixtures**

`assets/voice-fixtures/PHRASES.md`:

```markdown
# Voice benchmark phrases

Record each phrase as `assets/voice-fixtures/NN.wav` (16 kHz mono):

    arecord -f S16_LE -r 16000 -c 1 -d 8 assets/voice-fixtures/01.wav

01. "prebaci na file panes"
02. "otvori grid"
03. "zatvori grid za voice"
04. "dodaj claude terminal u file panes sa promptom sredi failing testove u Sidebar komponenti"
05. "dodaj codex terminal"
06. "zatvori drugi tab"
07. "preimenuj feature u export import"
08. "switch to the voice feature"
09. "add a claude terminal with prompt refactor the store"
10. "promeni grid stil u kolone"

Expected-transcript ground truth lives next to each wav as `NN.txt` (latinica).
```

Record the 10 wavs (one-time, ~3 minutes of work) and write each `NN.txt`.

- [ ] **Step 3: Benchmark script**

`scripts/voice-bench.mjs`:

```js
// Compares whisper models on the fixture commands: per-model average latency
// and word accuracy against NN.txt ground truth. Decides the shipped default
// modelId (spec: "chosen by measurement").
//   node scripts/voice-bench.mjs [modelsDir]
// Models must already sit in modelsDir (default ~/.config/brain/voice-models);
// download via the URLS below with curl -L if missing.
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const addon = require('@kutalia/whisper-node-addon')
const transcribe = addon.transcribe ?? addon.default?.transcribe

const URLS = {
  'ggml-large-v3-sr-q5_0.bin': 'https://huggingface.co/Sagicc/Whisper.cpp/resolve/main/ggml-large-v3-sr-q5_0.bin',
  'ggml-whisper-small-sr-q5_0.bin': 'https://huggingface.co/Sagicc/Whisper.cpp/resolve/main/ggml-whisper-small-sr-q5_0.bin',
  'ggml-large-v3-turbo-q5_0.bin': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
}

const modelsDir = process.argv[2] ?? join(homedir(), '.config', 'brain', 'voice-models')
const fixturesDir = 'assets/voice-fixtures'

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').split(/\s+/).filter(Boolean)
const wordAcc = (got, want) => {
  const g = norm(got), w = norm(want)
  if (w.length === 0) return 0
  const gset = new Set(g)
  return w.filter((x) => gset.has(x)).length / w.length
}

const segText = (r) => (typeof r === 'string' ? r
  : (Array.isArray(r) ? r : r?.transcription ?? []).map((s) => s?.[2] ?? '').join('')).replace(/\s+/g, ' ').trim()

const wavs = readdirSync(fixturesDir).filter((f) => f.endsWith('.wav')).sort()
if (wavs.length === 0) { console.error(`no fixtures in ${fixturesDir} — see PHRASES.md`); process.exit(1) }

for (const [file, url] of Object.entries(URLS)) {
  const model = join(modelsDir, file)
  if (!existsSync(model)) { console.log(`SKIP ${file} (missing — curl -L -o '${model}' '${url}')`); continue }
  let accSum = 0, msSum = 0, n = 0
  for (const wav of wavs) {
    const truthPath = join(fixturesDir, wav.replace(/\.wav$/, '.txt'))
    if (!existsSync(truthPath)) continue
    const t0 = Date.now()
    const result = await transcribe({ fname_inp: join(fixturesDir, wav), model, language: 'sr', use_gpu: true, no_prints: true, no_timestamps: true })
    const ms = Date.now() - t0
    const text = segText(result)
    const acc = wordAcc(text, readFileSync(truthPath, 'utf8'))
    accSum += acc; msSum += ms; n++
    console.log(`  ${wav}  ${ms}ms  acc=${(acc * 100).toFixed(0)}%  "${text}"`)
  }
  if (n) console.log(`${file}: avg acc ${(accSum / n * 100).toFixed(1)}%, avg ${Math.round(msSum / n)}ms over ${n} clips\n`)
}
```

- [ ] **Step 4: Run the benchmark and set the default model**

```bash
node scripts/voice-bench.mjs
```

Decision rule (from the spec): highest name/word accuracy whose average
latency stays ≤ ~2500 ms. Update `DEFAULT_VOICE_CONFIG.modelId` in
`src/main/voice/config.ts` (and its test) if a different candidate wins;
record the numbers in a comment above the default.

- [ ] **Step 5: Manual E2E checklist**

With `npm run dev`, GROQ_API_KEY set, model downloaded:

- [ ] `Ctrl+Alt+Space` from ANOTHER app focuses Brain and starts listening
- [ ] "prebaci na <feature>" — switches feature (also across projects)
- [ ] "otvori grid" / "zatvori grid" — toggles, toast shown
- [ ] voice "otvori grid" on a feature WITH hidden (X-ed) terminals — toast says hidden terminals were restored
- [ ] "prebaci na drugi tab" — ordinal counts only visible tabs
- [ ] "promeni grid stil u kolone" — grid style changes
- [ ] "sakrij terminal" — hides the active terminal
- [ ] "dodaj claude terminal sa promptom …" — confirm modal, edit prompt, Enter → terminal launches with the edited prompt; restart the app → the terminal resumes its own session (sessionId pin)
- [ ] "dodaj codex terminal" / "dodaj shell terminal sa promptom npm test"
- [ ] "zatvori terminal <name>" on a REVIEWER terminal — review loop stops cleanly (origin badge clears)
- [ ] "preimenuj feature u …" — confirm modal (no textarea), Enter renames
- [ ] English command ("switch to the voice feature") works
- [ ] mixed command ("dodaj claude terminal u file panes") works
- [ ] Esc during listening cancels; Esc during confirm cancels; Esc during Transcribing/Parsing/model-download cancels; pressing the shortcut mid-flow (while parsing / confirm open) cancels it and starts a new listen
- [ ] set `"shortcut"` in voice.json to a combination another app already owns → warning toast appears at startup; the mic button still works
- [ ] set `"enabled": false` in voice.json → mic button click shows "Voice is disabled" instead of hanging on Transcribing…
- [ ] second shortcut press while speaking stops recording immediately
- [ ] silence: shortcut, say nothing → auto-stop → "Nothing was heard"
- [ ] gibberish phrase → unknown → error toast with the transcript
- [ ] unset GROQ_API_KEY (and no voice.json key) → clear "API key missing" error WITH the transcript shown
- [ ] disconnect network (model already local) → Groq network error surfaces, transcript preserved
- [ ] deny mic permission → "Microphone unavailable" error
- [ ] delete `~/.config/brain/voice-models/` → next activation shows download progress, then works

- [ ] **Step 6: Final verification and commit**

```bash
npm run typecheck && npm test && npm run build
git add package.json scripts/voice-bench.mjs assets/voice-fixtures/
git commit -m "feat(voice): packaging, model benchmark, fixtures"
```

---

## Final integration

- [ ] Run `npm run typecheck && npm test` once more on the full tree — all green.
- [ ] Walk the Task 17 manual checklist top to bottom in one sitting.
- [ ] Update the README feature list with a one-liner + the privacy note from the spec ("audio never leaves the machine; the transcript and workspace names are sent to Groq").
- [ ] Merge per the project's git workflow (feature branch → `--no-ff` into master — confirm with the user before pushing).

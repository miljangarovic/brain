// Compares whisper models on the fixture commands: per-model average latency
// and word accuracy against NN.txt ground truth. Decides the shipped default
// modelId (spec: "chosen by measurement").
//
// INVOCATION (plain Node — LD_LIBRARY_PATH is required for the native .so files):
//
//   LD_LIBRARY_PATH="node_modules/@kutalia/whisper-node-addon/dist/linux-x64:$LD_LIBRARY_PATH" \
//     node scripts/voice-bench.mjs [modelsDir]
//
// Models must already sit in modelsDir (default ~/.config/brain/voice-models);
// download via the URLS below with curl -L if missing.
//
// If running outside Electron fails even with LD_LIBRARY_PATH, fall back to
// running the script from the app's main-process DevTools console or a
// temporary main-process hook.
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

for (const [file, url] of Object.entries(URLS)) {
  const model = join(modelsDir, file)
  if (!existsSync(model)) { console.log(`SKIP ${file} (missing — curl -L -o '${model}' '${url}')`); continue }
  if (wavs.length === 0) { console.error(`no fixtures in ${fixturesDir} — see PHRASES.md`); process.exit(1) }
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

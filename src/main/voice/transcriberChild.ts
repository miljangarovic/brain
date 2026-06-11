// Runs inside an Electron utilityProcess: loads the whisper addon (native,
// heavy) and serves transcribe requests over parentPort. Kept out of the main
// process so inference never blocks it and a native crash cannot take the
// app down (the parent respawns this child).
//
// NOTE (declared plan deviation): the @kutalia/whisper-node-addon 1.1.0 .d.ts
// exposes only a stateless `transcribe` function — there is no
// persistent-context / keep-model-loaded API (no init(), createContext(),
// or class wrapper). The model is therefore reloaded on every call.
//
// NOTE: the .d.ts has no `prompt` / `initial_prompt` option, so that
// parameter is omitted entirely.
import { extractTranscript } from './transcribeResult'

interface Req { id: number; wavPath: string; modelPath: string; language: string }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@kutalia/whisper-node-addon')
const transcribeFn: (o: Record<string, unknown>) => Promise<unknown> = addon.transcribe ?? addon.default?.transcribe

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as Req
  void (async () => {
    try {
      // Option names verified against the addon's .d.ts (Task 9 Step 1).
      // `prompt` is absent from the .d.ts and is intentionally omitted.
      const result = await transcribeFn({
        fname_inp: req.wavPath,
        model: req.modelPath,
        language: req.language,
        use_gpu: true,
        no_timestamps: true,
        no_prints: true,
      })
      process.parentPort.postMessage({ id: req.id, ok: true, text: extractTranscript(result) })
    } catch (err) {
      process.parentPort.postMessage({ id: req.id, ok: false, error: String(err) })
    }
  })()
})

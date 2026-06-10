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

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
  it('a joiner of an in-flight download receives progress too', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate
      return okResponse(new Uint8Array([1, 2]), 2)
    })
    const got: number[][] = []
    const p1 = ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, (r, t) => got.push([0, r, t ?? -1]))
    const p2 = ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, (r, t) => got.push([1, r, t ?? -1]))
    release()
    await Promise.all([p1, p2])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(got.some(([who]) => who === 0)).toBe(true)
    expect(got.some(([who]) => who === 1)).toBe(true)
  })
  it('a mid-stream error cleans up and a retry can succeed', async () => {
    const failing = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(new Uint8Array([1])); c.error(new Error('connection reset')) }
      })
    } as unknown as Response
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(failing)
      .mockResolvedValueOnce(okResponse(new Uint8Array([7, 8]), 2))
    await expect(ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, () => {})).rejects.toThrow(/connection reset/)
    expect((await fsp.readdir(dir).catch(() => []) as string[]).filter((f) => f.endsWith('.part'))).toEqual([])
    const path = await ensureModel('sagicc-small-sr-q5_0', dir, fetchImpl, () => {})
    expect(Array.from(await fsp.readFile(path))).toEqual([7, 8])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadFile, saveFile, TEXT_LIMIT, IMAGE_LIMIT } from './fileLoad'

const dir = () => mkdtempSync(join(tmpdir(), 'brain-fileload-'))

describe('loadFile', () => {
  it('reads UTF-8 text', async () => {
    const p = join(dir(), 'a.ts')
    writeFileSync(p, 'const x = 1\n')
    await expect(loadFile(p)).resolves.toEqual({ kind: 'text', content: 'const x = 1\n' })
  })

  it('detects images by extension and returns a data URL', async () => {
    const p = join(dir(), 'pix.png')
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const res = await loadFile(p)
    expect(res.kind).toBe('image')
    if (res.kind === 'image') expect(res.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('detects binary via null bytes', async () => {
    const p = join(dir(), 'blob.bin')
    writeFileSync(p, Buffer.from([0x68, 0x00, 0x69]))
    await expect(loadFile(p)).resolves.toEqual({ kind: 'binary' })
  })

  it('rejects oversized text as too-large with the size', async () => {
    const p = join(dir(), 'big.txt')
    writeFileSync(p, 'x'.repeat(TEXT_LIMIT + 1))
    await expect(loadFile(p)).resolves.toEqual({ kind: 'too-large', size: TEXT_LIMIT + 1 })
  })

  it('rejects oversized images as too-large with the size', async () => {
    const p = join(dir(), 'big.png')
    writeFileSync(p, Buffer.alloc(IMAGE_LIMIT + 1))
    await expect(loadFile(p)).resolves.toEqual({ kind: 'too-large', size: IMAGE_LIMIT + 1 })
  })

  it('missing/unreadable files report missing', async () => {
    await expect(loadFile(join(dir(), 'nope.txt'))).resolves.toEqual({ kind: 'missing' })
  })
})

describe('saveFile', () => {
  it('writes content and round-trips through loadFile', async () => {
    const p = join(dir(), 'out.md')
    await expect(saveFile(p, '# hello')).resolves.toEqual({ ok: true })
    await expect(loadFile(p)).resolves.toEqual({ kind: 'text', content: '# hello' })
  })

  it('reports failure as ok:false with an error string', async () => {
    const res = await saveFile(join(dir(), 'no-such-dir', 'x.txt'), 'x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBeTruthy()
  })
})

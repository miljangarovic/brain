import { promises as fsp } from 'fs'
import { extname } from 'path'
import type { FileLoadResult } from '@shared/files'

export const TEXT_LIMIT = 2 * 1024 * 1024    // editor cap
export const IMAGE_LIMIT = 20 * 1024 * 1024  // data-URL cap

// Image detection is by extension — content sniffing buys little here and the
// <img> tag fails gracefully on a lying extension.
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

// What can the renderer do with this path? Text within the limit is editable;
// images become data URLs (a file:// src does not load from the dev-server
// origin); null bytes in the head or invalid UTF-8 read as binary.
export async function loadFile(path: string): Promise<FileLoadResult> {
  let buf: Buffer
  try { buf = await fsp.readFile(path) } catch { return { kind: 'missing' } }
  const mime = IMAGE_MIME[extname(path).toLowerCase()]
  if (mime) {
    if (buf.length > IMAGE_LIMIT) return { kind: 'too-large', size: buf.length }
    return { kind: 'image', dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  }
  if (buf.subarray(0, 8192).includes(0)) return { kind: 'binary' }
  if (buf.length > TEXT_LIMIT) return { kind: 'too-large', size: buf.length }
  const content = buf.toString('utf8')
  // The replacement char only appears when decoding hit invalid UTF-8 (or the
  // file legitimately contains U+FFFD — rare enough to accept as "binary").
  if (content.includes('�')) return { kind: 'binary' }
  return { kind: 'text', content }
}

export async function saveFile(path: string, content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fsp.writeFile(path, content, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

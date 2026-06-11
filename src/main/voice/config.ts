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

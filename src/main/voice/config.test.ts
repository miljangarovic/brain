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

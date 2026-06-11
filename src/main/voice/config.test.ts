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
  it('accepts mouseTrigger literals', () => {
    expect(parseVoiceConfig({ mouseTrigger: 'back' }).mouseTrigger).toBe('back')
    expect(parseVoiceConfig({ mouseTrigger: 'off' }).mouseTrigger).toBe('off')
    expect(parseVoiceConfig({ mouseTrigger: 'forward' }).mouseTrigger).toBe('forward')
  })
  it('falls back to forward for invalid mouseTrigger', () => {
    expect(parseVoiceConfig({ mouseTrigger: 'middle' }).mouseTrigger).toBe('forward')
    expect(parseVoiceConfig({ mouseTrigger: 7 }).mouseTrigger).toBe('forward')
    expect(parseVoiceConfig({}).mouseTrigger).toBe('forward')
  })
  it('accepts mouseTriggerMode literals', () => {
    expect(parseVoiceConfig({ mouseTriggerMode: 'click' }).mouseTriggerMode).toBe('click')
    expect(parseVoiceConfig({ mouseTriggerMode: 'hold' }).mouseTriggerMode).toBe('hold')
  })
  it('falls back to hold for invalid mouseTriggerMode', () => {
    expect(parseVoiceConfig({ mouseTriggerMode: 'toggle' }).mouseTriggerMode).toBe('hold')
    expect(parseVoiceConfig({ mouseTriggerMode: 1 }).mouseTriggerMode).toBe('hold')
    expect(parseVoiceConfig({}).mouseTriggerMode).toBe('hold')
  })
})

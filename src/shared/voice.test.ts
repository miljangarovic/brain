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
  it('strips empty and whitespace-only strings, trims padded ones', () => {
    const cmd = validateVoiceCommand({ action: 'rename_feature', featureId: '', name: '  novo ime  ', confidence: 'high' })
    expect(cmd.featureId).toBeUndefined()
    expect(cmd.name).toBe('novo ime')
  })
  it('an explicit unknown action is never high-confidence', () => {
    expect(validateVoiceCommand({ action: 'unknown', confidence: 'high' }))
      .toEqual({ action: 'unknown', confidence: 'low' })
  })
  it('passes send_prompt through', () => {
    expect(validateVoiceCommand({ action: 'send_prompt', terminalId: 't1', prompt: 'sredi testove', confidence: 'high' }))
      .toEqual({ action: 'send_prompt', terminalId: 't1', prompt: 'sredi testove', confidence: 'high' })
  })
  it('passes the batch-2 actions through with their fields', () => {
    expect(validateVoiceCommand({ action: 'cycle_tab', direction: 'prev', confidence: 'high' }))
      .toEqual({ action: 'cycle_tab', direction: 'prev', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'close_tabs', scope: 'left', terminalId: 't1', confidence: 'high' }))
      .toEqual({ action: 'close_tabs', scope: 'left', terminalId: 't1', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'add_feature', groupId: 'g1', name: 'search', confidence: 'high' }))
      .toEqual({ action: 'add_feature', groupId: 'g1', name: 'search', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'archive_feature', featureId: 'f1', confidence: 'high' }))
      .toEqual({ action: 'archive_feature', featureId: 'f1', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'review_accept', confidence: 'high' }))
      .toEqual({ action: 'review_accept', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'review_more_rounds', confidence: 'high' }))
      .toEqual({ action: 'review_more_rounds', confidence: 'high' })
    expect(validateVoiceCommand({ action: 'review_stop', confidence: 'high' }))
      .toEqual({ action: 'review_stop', confidence: 'high' })
  })
  it('strips invalid direction and scope', () => {
    expect(validateVoiceCommand({ action: 'close_tabs', scope: 'middle', direction: 'sideways', confidence: 'high' }))
      .toEqual({ action: 'close_tabs', confidence: 'high' })
  })
})

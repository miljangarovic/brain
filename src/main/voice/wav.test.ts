import { describe, it, expect } from 'vitest'
import { encodeWavPcm16 } from './wav'

describe('encodeWavPcm16', () => {
  it('writes a valid 16kHz mono 16-bit RIFF header', () => {
    const buf = encodeWavPcm16(new Float32Array([0, 0.5, -0.5]), 16000)
    expect(buf.length).toBe(44 + 3 * 2)
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE')
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ')
    expect(buf.toString('ascii', 36, 40)).toBe('data')
    expect(buf.readUInt32LE(4)).toBe(36 + 6)        // riff chunk size
    expect(buf.readUInt32LE(16)).toBe(16)           // fmt chunk size
    expect(buf.readUInt16LE(20)).toBe(1)            // PCM format tag
    expect(buf.readUInt16LE(32)).toBe(2)            // block align
    expect(buf.readUInt16LE(22)).toBe(1)            // mono
    expect(buf.readUInt32LE(24)).toBe(16000)        // sample rate
    expect(buf.readUInt32LE(28)).toBe(16000 * 2)    // byte rate
    expect(buf.readUInt16LE(34)).toBe(16)           // bits per sample
    expect(buf.readUInt32LE(40)).toBe(6)            // data size
  })
  it('converts samples to little-endian int16 with clamping', () => {
    const buf = encodeWavPcm16(new Float32Array([0, 1, -1, 2, -2]), 16000)
    expect(buf.readInt16LE(44)).toBe(0)
    expect(buf.readInt16LE(46)).toBe(32767)
    expect(buf.readInt16LE(48)).toBe(-32768)
    expect(buf.readInt16LE(50)).toBe(32767)   // clamped
    expect(buf.readInt16LE(52)).toBe(-32768)  // clamped
  })
})

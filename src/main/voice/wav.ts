// Minimal mono 16-bit PCM WAV encoder — the whisper addon's stable input is a
// file path, so the recorded Float32 PCM is wrapped in a WAV container.
export function encodeWavPcm16(pcm: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    data.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)              // fmt chunk size
  header.writeUInt16LE(1, 20)               // PCM
  header.writeUInt16LE(1, 22)               // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)  // byte rate
  header.writeUInt16LE(2, 32)               // block align
  header.writeUInt16LE(16, 34)              // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

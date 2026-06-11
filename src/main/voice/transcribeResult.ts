// The addon returns whisper.cpp segments ({ transcription: [[from, to, text], …] }
// in the upstream addon; tolerate a bare array or a string in case the fork
// changes shape between versions).
// The .d.ts declares transcription as string[][] | string[]:
//   - string[][] — triplet segments [from, to, text]
//   - string[]  — flat text segments (no timestamps)
export function extractTranscript(result: unknown): string {
  if (typeof result === 'string') return result.trim()
  const segs = Array.isArray(result)
    ? result
    : (typeof result === 'object' && result !== null && Array.isArray((result as { transcription?: unknown }).transcription))
      ? (result as { transcription: unknown[] }).transcription
      : null
  if (!segs) return ''
  return segs
    .map((s) => {
      // string[][] triplet: [from, to, text]
      if (Array.isArray(s) && typeof s[2] === 'string') return s[2]
      // string[] flat segment (no_timestamps=true may yield plain strings)
      if (typeof s === 'string') return s
      return ''
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

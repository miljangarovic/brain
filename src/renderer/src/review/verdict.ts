export type Verdict = 'approved' | 'needs-work'

// The reviewer is instructed to put `VERDICT: APPROVED|NEEDS-WORK` on the first
// non-empty line. Anything else (missing/garbled) falls back to needs-work, the
// safe branch — a misformatted verdict never silently ends the loop.
export function parseVerdict(fileText: string): Verdict {
  const firstLine = fileText.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const m = firstLine.toUpperCase().match(/VERDICT:\s*(APPROVED|NEEDS-WORK)/)
  return m && m[1] === 'APPROVED' ? 'approved' : 'needs-work'
}

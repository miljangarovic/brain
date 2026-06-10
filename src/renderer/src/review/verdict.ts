export type Verdict = 'approved' | 'needs-work'

// The reviewer is instructed to put `VERDICT: APPROVED|NEEDS-WORK` on the first
// non-empty line. Strict parse: the verdict actually present, or null when there
// is none yet — an empty/partially-written file must not be mistaken for a
// verdict, so the watcher keeps waiting instead of acting on it.
export function parseVerdictStrict(fileText: string): Verdict | null {
  const firstLine = fileText.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  const m = firstLine.toUpperCase().match(/VERDICT:\s*(APPROVED|NEEDS-WORK)/)
  if (!m) return null
  return m[1] === 'APPROVED' ? 'approved' : 'needs-work'
}


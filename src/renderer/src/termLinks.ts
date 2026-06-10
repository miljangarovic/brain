// Path-like tokens in a rendered terminal line, for Ctrl+click file links.
// Three shapes are recognized:
//   1. rooted:   /abs/x, ~/x, ./x, ../x
//   2. relative with at least one separator:  src/main/ipc.ts
//   3. bare filename with an extension:       package.json
// A `:line[:col]` suffix (claude/codex print these constantly) is consumed
// into the clickable range and parsed. Existence is NOT checked here — the
// caller filters the candidates against the real filesystem.

export interface PathCandidate {
  start: number  // 0-based index of the first char in the line
  end: number    // 0-based index AFTER the last char (exclusive)
  text: string   // the full clickable text, including any :line:col suffix
  path: string   // the path portion only
  line?: number  // parsed :line suffix
}

const SEG = '[\\w.@+%~-]+'
const CAND_RE = new RegExp(
  `(?:~|\\.{1,2})?(?:/${SEG})+` +              // rooted: /a/b, ~/a, ./a, ../a/b
  `|${SEG}(?:/${SEG})+` +                      // relative with a dir: src/a.ts
  `|[\\w@+%-][\\w.@+%-]*\\.[A-Za-z]\\w{0,7}`,  // bare file: package.json
  'g'
)

export function findPathCandidates(lineText: string): PathCandidate[] {
  const out: PathCandidate[] = []
  CAND_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CAND_RE.exec(lineText))) {
    // A candidate right after '/' or ':' is the tail of a URL (https://…) or
    // of some longer token — never a standalone path.
    const prev = m.index > 0 ? lineText[m.index - 1] : ''
    if (prev === '/' || prev === ':') continue
    let raw = m[0]
    let line: number | undefined
    let suffixLen = 0
    const suffix = lineText.slice(m.index + raw.length).match(/^:(\d+)(?::\d+)?/)
    if (suffix) {
      line = parseInt(suffix[1], 10)
      suffixLen = suffix[0].length
    } else {
      // Sentence punctuation glued to the path ('vidi src/a.ts.') is not part
      // of it — but keep genuine '..' / '/.' endings intact.
      while (raw.length > 1 && /[.,;]$/.test(raw) && !/(\.\.|\/\.)$/.test(raw)) raw = raw.slice(0, -1)
    }
    const end = m.index + raw.length + suffixLen
    out.push({ start: m.index, end, text: lineText.slice(m.index, end), path: raw, line })
  }
  return out
}

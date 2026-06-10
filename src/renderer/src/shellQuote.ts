/** POSIX single-quote escaping for embedding a prompt as one shell argument. */
export function shellSingleQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

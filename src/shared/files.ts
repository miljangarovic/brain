// Result of file:load — what the renderer can do with a path. Text within the
// limit is editable; images render read-only; everything else gets a fallback.
export type FileLoadResult =
  | { kind: 'text'; content: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'binary' }
  | { kind: 'too-large'; size: number }
  | { kind: 'missing' }

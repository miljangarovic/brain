// Terminals whose PTY just exited. Main emits the exit event and then the busy
// tracker's trailing busy:false back-to-back; without this latch that trailing
// idle reclassifies the dead terminal's tail as 'done', instantly overwriting
// the 'error' alert the exit handler just fired (red dot → blue, plus a bogus
// "finished" notification right after "crashed"). The exit handler marks the
// id; the idle handler consumes it once and skips.
const exited = new Set<string>()

export function markExited(id: string): void { exited.add(id) }
// One-shot: true exactly once after marking — the next busy cycle for this id
// belongs to a live (re)spawned process.
export function consumeExited(id: string): boolean { return exited.delete(id) }
export function clearExited(id: string): void { exited.delete(id) }

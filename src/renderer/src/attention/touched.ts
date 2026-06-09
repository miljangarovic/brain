// Terminals the user has actually typed/pasted into during this session.
// Attention's idle-derived signals (done / waiting-input) only surface for
// engaged terminals — so opening/restoring a workspace full of agents does NOT
// fire a storm of "finished" alerts for terminals you never touched. (Crashes
// — exit errors — are reported regardless, since those matter even untouched.)
const touched = new Set<string>()

export function markTouched(id: string): void { touched.add(id) }
export function isTouched(id: string): boolean { return touched.has(id) }
export function clearTouched(id: string): void { touched.delete(id) }

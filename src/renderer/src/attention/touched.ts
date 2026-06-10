// Terminals the user has typed/pasted into since the last attention alert —
// the "armed" set. Attention's idle-derived signals (done / waiting-input)
// only surface for armed terminals, and useAttention disarms (clearTouched) a
// terminal after alerting it. So: restoring a workspace full of agents never
// fires a storm of "finished" alerts, and a background terminal repainting
// after its alert stays silent until you actually work in it again. (Crashes
// — exit errors — are reported regardless, since those matter even untouched.)
const touched = new Set<string>()

export function markTouched(id: string): void { touched.add(id) }
export function isTouched(id: string): boolean { return touched.has(id) }
export function clearTouched(id: string): void { touched.delete(id) }

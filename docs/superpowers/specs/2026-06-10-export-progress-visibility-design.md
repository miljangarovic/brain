# Export Progress Visibility — Design

**Date:** 2026-06-10
**Status:** Approved
**Builds on:** `2026-06-10-export-import-project-design.md` (shipped)

## Goal

Make a running export visible and its completion unmissable: a progress bar with a
percentage, a per-session status list, a native OS notification on success, and a
"Show in folder" action on the result toast.

## Background / problem

Summarization takes tens of seconds per session. The current toast shows only
`Summarizing sessions <done>/<total> — <last finished>`, which reads as a static
number for long stretches, and completion is only a passive text line.

## Design

### 1. Progress data: full snapshots

`ExportProgress` (in `src/shared/exportTypes.ts`) changes shape — `current` is removed:

```typescript
export type ExportSessionState = 'pending' | 'running' | 'done' | 'error'

export interface ExportProgress {
  done: number
  total: number
  items: { label: string; state: ExportSessionState }[]  // one per agent session, stable order
}
```

`runExport` (in `src/main/exportImport.ts`) builds `items` up front from the collected
session refs (all `pending`, label `"<feature>/<terminal>"`), flips an item to `running`
when its summarization starts and to `done`/`error` when it finishes, and emits a fresh
snapshot (new array/objects, never a mutated shared reference) on every transition plus
one initial snapshot. The renderer renders the latest snapshot only — late or dropped
events are harmless because each snapshot is complete. `mapWithLimit` and
`summarizeSession` are untouched.

### 2. Toast: bar + session list

`ExportToast` while exporting shows:

- Header: `Exporting — 40% (2/5)` where `% = round(done/total*100)`; `0/0` (no agent
  sessions) shows no bar/list, just a brief "Writing archive…" line.
- A thin progress bar (accent fill, width = percentage).
- A scrollable list (max height ~6 rows, `overflow-y-auto`) of all sessions in order:
  state icon + label. Icons: pending `·` (muted), running spinner (accent),
  done `✓` (accent/green), error `✕` (danger).

The finished toast becomes `{ text, path? }` instead of a plain string:

- Success: text + **Show in folder** button + existing Dismiss.
- Failure / import results: text + Dismiss (no path → no button).

### 3. Completion signals

- **OS notification** on successful export via the existing notifier
  (`window.brain.showNotification({ key, title, body })`): title `Export finished`,
  body = zip filename, key = `export:<path>` (clicking focuses the app window —
  existing behavior; the attention lookup for an unknown key is a no-op).
- **Show in folder**: new IPC `shell:showItem` → Electron `shell.showItemInFolder(path)`
  (opens the file manager with the zip selected). Exposed as `BrainApi.showItemInFolder(path)`.

### 4. App state changes (`App.tsx`)

- `exportNotice: string | null` becomes `{ text: string; path?: string } | null`.
- `finishExport` on success: sets notice with `path`, fires the OS notification.
  Import flows keep setting text-only notices.
- The `transferRef` double-trigger/late-event guard stays as is.

## Out of scope

- Intra-session progress (an LLM call has no measurable completion fraction — any
  within-session percentage would be invented).
- Import progress (extraction is near-instant).
- Cancel button for a running export.

## Testing

- `runExport` snapshot sequence: initial all-pending snapshot; each session goes
  running → done/error; final snapshot has `done === total`; snapshots are
  independent copies (mutating one does not affect previously captured ones).
- `ExportToast`: percentage + bar width, list rendering with all four states,
  "Writing archive…" for `total === 0`, Show-in-folder button calls the API with the
  path, button absent for text-only notices.
- `App` wiring is covered by typecheck + existing suite (no App unit tests exist);
  updated existing tests for the changed `ExportProgress`/notice shapes.

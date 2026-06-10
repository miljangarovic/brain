# Export Progress Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a percentage bar + per-session status list while an export runs, and make completion unmissable (OS notification + "Show in folder" button).

**Architecture:** `runExport` switches from `{done,total,current}` events to full snapshots `{done,total,items:[{label,state}]}` — every transition re-emits complete fresh copies, so the renderer just renders the latest snapshot. A tiny new `shell:showItem` IPC exposes Electron's `shell.showItemInFolder`. The result notice becomes `{text, path?}` so the toast can offer the folder button; success also fires the existing OS notifier.

**Tech Stack:** Existing stack (Electron 31, React 18, vitest). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-10-export-progress-visibility-design.md`

**Branch:** create `feature/export-progress` off `develop` before Task 1.

---

## File structure

| File | Change |
|---|---|
| `src/shared/exportTypes.ts` | `ExportProgress` → snapshot shape; new `ExportSessionState` |
| `src/main/exportImport.ts` | `runExport` emits state snapshots |
| `src/main/exportImport.test.ts` | snapshot-sequence assertions |
| `src/renderer/src/components/ExportToast.tsx` | bar + % + session list; notice `{text, path?}` + Show in folder |
| `src/renderer/src/components/ExportToast.test.tsx` | updated + new cases |
| `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts` | `shell:showItem` |
| `src/renderer/src/App.tsx` | notice object, OS notification on success |

Tasks 1 is atomic (the type change breaks compile of `runExport` + toast together); Task 3 is atomic (the notice prop change breaks App compile).

---

### Task 0: Branch

- [ ] **Step 1:**

```bash
git checkout -b feature/export-progress develop
```

---

### Task 1: Snapshot progress (type + runExport + toast progress view)

**Files:**
- Modify: `src/shared/exportTypes.ts` (the `ExportProgress` line)
- Modify: `src/main/exportImport.ts:43-67` (`runExport` summarize loop)
- Modify: `src/main/exportImport.test.ts` (the `runExport` describe)
- Modify: `src/renderer/src/components/ExportToast.tsx` (progress branch)
- Modify: `src/renderer/src/components/ExportToast.test.tsx`

- [ ] **Step 1: Update the runExport test** — in `src/main/exportImport.test.ts`, add `ExportProgress` to the type import from `@shared/exportTypes` (it currently imports only `ExportManifest`), then replace the body of the `it('writes a zip with manifest + one md per successful summary; failures become warnings', ...)` test's progress plumbing — the lines

```typescript
    const progress: { done: number; total: number }[] = []
```
and
```typescript
      onProgress: (p) => progress.push({ done: p.done, total: p.total })
```
and
```typescript
    expect(progress[0]).toEqual({ done: 0, total: 2 })
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 })
```

become:

```typescript
    const progress: ExportProgress[] = []
```
```typescript
      onProgress: (p) => progress.push(p)
```
```typescript
    expect(progress[0]).toEqual({ done: 0, total: 2, items: [
      { label: 'Auth Flow/claude', state: 'pending' },
      { label: 'Auth Flow/codex', state: 'pending' }
    ] })
    expect(progress.at(-1)).toEqual({ done: 2, total: 2, items: [
      { label: 'Auth Flow/claude', state: 'done' },
      { label: 'Auth Flow/codex', state: 'error' }
    ] })
    // a running state was visible at some point, and snapshots are independent
    // copies — the first one must still be all-pending after the run finished
    expect(progress.some((p) => p.items.some((i) => i.state === 'running'))).toBe(true)
    expect(progress[0].items.every((i) => i.state === 'pending')).toBe(true)
```

- [ ] **Step 2: Update the ExportToast tests** — replace the middle of `src/renderer/src/components/ExportToast.test.tsx` so the file becomes:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportToast } from './ExportToast'
import type { ExportProgress, ExportSessionState } from '@shared/exportTypes'

const prog = (done: number, total: number, states: ExportSessionState[]): ExportProgress => ({
  done, total,
  items: states.map((state, i) => ({ label: `feat/term${i}`, state }))
})

describe('ExportToast', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<ExportToast progress={null} notice={null} onDismiss={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows percentage, counts and the per-session list', () => {
    render(<ExportToast progress={prog(2, 5, ['done', 'done', 'running', 'pending', 'error'])} notice={null} onDismiss={() => {}} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Exporting — 40%')
    expect(status).toHaveTextContent('2/5')
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(status).toHaveTextContent('feat/term3')
  })

  it('shows a writing-archive line when there are no sessions', () => {
    render(<ExportToast progress={prog(0, 0, [])} notice={null} onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Writing archive…')
  })

  it('shows a dismissible notice when done', async () => {
    const onDismiss = vi.fn()
    render(<ExportToast progress={null} notice="Exported to /tmp/x.zip" onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('Exported to /tmp/x.zip')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('progress wins over a stale notice', () => {
    render(<ExportToast progress={prog(0, 2, ['running', 'pending'])} notice="old" onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Exporting — 0%')
    expect(screen.queryByText('old')).not.toBeInTheDocument()
  })
})
```

(The notice stays a plain string in this task; Task 3 upgrades it.)

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run src/main/exportImport.test.ts src/renderer/src/components/ExportToast.test.tsx`
Expected: FAIL — `items`/`ExportSessionState` don't exist yet; toast renders old layout.

- [ ] **Step 4: Change the type** — in `src/shared/exportTypes.ts` replace

```typescript
export interface ExportProgress { done: number; total: number; current: string /* "feature/terminal" label */ }
```

with:

```typescript
export type ExportSessionState = 'pending' | 'running' | 'done' | 'error'

export interface ExportProgress {
  done: number
  total: number
  // One entry per agent session, stable order. Every event is a complete,
  // self-contained snapshot — the renderer just renders the latest one.
  items: { label: string; state: ExportSessionState }[]
}
```

- [ ] **Step 5: Emit snapshots from `runExport`** — in `src/main/exportImport.ts`, add `ExportSessionState` to the type-only names imported from `@shared/exportTypes`, then replace the block from `let done = 0` through the end of the `mapWithLimit(...)` call with:

```typescript
  // Progress is reported as full snapshots: every transition re-emits the whole
  // list as fresh copies, so a late or dropped event can never corrupt the view.
  const states: ExportSessionState[] = refs.map(() => 'pending')
  let done = 0
  const snapshot = (): ExportProgress => ({
    done,
    total: refs.length,
    items: refs.map((r, i) => ({ label: `${r.featureName}/${r.terminalName}`, state: states[i] }))
  })
  onProgress?.(snapshot())
  await mapWithLimit(refs, SUMMARY_CONCURRENCY, async (ref, i) => {
    states[i] = 'running'
    onProgress?.(snapshot())
    const res = await summarize(ref)
    if (res.ok) {
      const file = sessionFileName(ref.featureName, ref.terminalName, ref.terminalId)
      sessions[ref.terminalId] = { kind: ref.kind, file }
      files.push({ name: file, content: res.markdown })
    } else {
      sessions[ref.terminalId] = { kind: ref.kind, error: res.error }
    }
    states[i] = res.ok ? 'done' : 'error'
    done++
    onProgress?.(snapshot())
  })
```

(`mapWithLimit` already passes `(item, index)` to its callback.)

- [ ] **Step 6: Rebuild the toast's progress branch** — replace `src/renderer/src/components/ExportToast.tsx` with:

```tsx
import type { ExportProgress, ExportSessionState } from '@shared/exportTypes'
import { SpinnerIcon } from './icons'

const STATE_ICON: Record<Exclude<ExportSessionState, 'running'>, { glyph: string; cls: string }> = {
  pending: { glyph: '·', cls: 'text-fg-muted' },
  done: { glyph: '✓', cls: 'text-accent' },
  error: { glyph: '✕', cls: 'text-danger' }
}

// Bottom-right toast for export/import: a percentage bar plus per-session
// status list while an export runs, then a dismissible result line (also
// reused for import results).
export function ExportToast({ progress, notice, onDismiss }: {
  progress: ExportProgress | null
  notice: string | null
  onDismiss: () => void
}) {
  if (!progress && !notice) return null
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="fixed bottom-3 right-3 z-50 w-80 max-w-[90vw] rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg shadow-xl shadow-black/50">
      {progress ? (
        progress.total === 0 ? (
          <div className="flex items-center gap-2">
            <SpinnerIcon className="shrink-0 text-accent" />
            <span>Writing archive…</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Exporting — {pct}%</span>
              <span className="text-fg-muted">{progress.done}/{progress.total}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sel">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <ul className="mt-1.5 max-h-36 overflow-y-auto">
              {progress.items.map((it, i) => (
                <li key={i} className="flex items-center gap-2 py-0.5 text-xs">
                  {it.state === 'running'
                    ? <SpinnerIcon className="shrink-0 text-accent" />
                    : <span className={`w-3 shrink-0 text-center ${STATE_ICON[it.state].cls}`}>{STATE_ICON[it.state].glyph}</span>}
                  <span className={`truncate ${it.state === 'pending' ? 'text-fg-muted' : ''}`}>{it.label}</span>
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 break-words">{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 px-1 text-fg-muted transition hover:text-fg">✕</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run the two test files, then typecheck and full suite**

Run: `npx vitest run src/main/exportImport.test.ts src/renderer/src/components/ExportToast.test.tsx && npm run typecheck && npm test`
Expected: all PASS (App.tsx compiles unchanged — it only stores and forwards `ExportProgress`).

- [ ] **Step 8: Commit**

```bash
git add src/shared/exportTypes.ts src/main/exportImport.ts src/main/exportImport.test.ts src/renderer/src/components/ExportToast.tsx src/renderer/src/components/ExportToast.test.tsx
git commit -m "feat(export): per-session snapshot progress with percentage bar and status list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `shell:showItem` IPC

**Files:**
- Modify: `src/shared/ipc.ts` (one constant)
- Modify: `src/shared/api.ts` (one method)
- Modify: `src/preload/index.ts` (one bridge entry)
- Modify: `src/main/ipc.ts` (one handler, next to `shellOpenPath` at line ~68)

Wiring only — the gate is typecheck + suite (consistent with the rest of `ipc.ts`).

- [ ] **Step 1:** In `src/shared/ipc.ts` add after `shellOpenPath: 'shell:openPath',`:

```typescript
  shellShowItem: 'shell:showItem',
```

- [ ] **Step 2:** In `src/shared/api.ts` add to `BrainApi` (after `openPath`):

```typescript
  // Reveal a file in the OS file manager (folder opened, file selected).
  showItemInFolder(path: string): void
```

- [ ] **Step 3:** In `src/preload/index.ts` add to the `api` object (after `openPath`):

```typescript
  showItemInFolder: (path: string) => ipcRenderer.send(IPC.shellShowItem, { path }),
```

- [ ] **Step 4:** In `src/main/ipc.ts` add directly under the `shellOpenPath` handler:

```typescript
  ipcMain.on(IPC.shellShowItem, (_e, p: { path: string }) => { if (p?.path) shell.showItemInFolder(p.path) })
```

- [ ] **Step 5:** Run: `npm run typecheck && npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(export): shell:showItem IPC to reveal the exported zip

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Notice object + Show in folder + OS notification

**Files:**
- Modify: `src/renderer/src/components/ExportToast.tsx` (notice prop + branch)
- Modify: `src/renderer/src/components/ExportToast.test.tsx`
- Modify: `src/renderer/src/App.tsx` (notice state, `finishExport`, import notices)

- [ ] **Step 1: Update + extend the toast tests** — in `ExportToast.test.tsx`, change the two notice tests and add two new ones:

```tsx
  it('shows a dismissible notice when done', async () => {
    const onDismiss = vi.fn()
    render(<ExportToast progress={null} notice={{ text: 'Exported to /tmp/x.zip' }} onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('Exported to /tmp/x.zip')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('progress wins over a stale notice', () => {
    render(<ExportToast progress={prog(0, 2, ['running', 'pending'])} notice={{ text: 'old' }} onDismiss={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Exporting — 0%')
    expect(screen.queryByText('old')).not.toBeInTheDocument()
  })

  it('notice with a path offers Show in folder', async () => {
    const showItem = vi.fn()
    ;(window as unknown as { brain: { showItemInFolder: (p: string) => void } }).brain = { showItemInFolder: showItem }
    render(<ExportToast progress={null} notice={{ text: 'Exported to /tmp/x.zip', path: '/tmp/x.zip' }} onDismiss={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    expect(showItem).toHaveBeenCalledWith('/tmp/x.zip')
  })

  it('text-only notice has no folder button', () => {
    render(<ExportToast progress={null} notice={{ text: 'Import failed: x' }} onDismiss={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Show in folder' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2:** Run: `npx vitest run src/renderer/src/components/ExportToast.test.tsx`
Expected: the four notice tests FAIL (prop is still a string).

- [ ] **Step 3: Upgrade the toast notice branch** — in `ExportToast.tsx` change the prop type and the notice branch:

```tsx
export interface ExportNotice { text: string; path?: string }
```

```tsx
export function ExportToast({ progress, notice, onDismiss }: {
  progress: ExportProgress | null
  notice: ExportNotice | null
  onDismiss: () => void
}) {
```

and the notice branch becomes:

```tsx
        <div className="flex items-center gap-2">
          <span className="min-w-0 break-words">{notice!.text}</span>
          {notice!.path && (
            <button type="button" onClick={() => window.brain.showItemInFolder(notice!.path!)}
              className="shrink-0 rounded border border-divider px-1.5 py-0.5 text-xs text-fg-muted transition hover:border-accent hover:text-accent">
              Show in folder
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={onDismiss} className="shrink-0 px-1 text-fg-muted transition hover:text-fg">✕</button>
        </div>
```

- [ ] **Step 4: Update App.tsx** —

4a. State (line ~63):

```typescript
  const [exportNotice, setExportNotice] = useState<{ text: string; path?: string } | null>(null)
```

4b. `finishExport` becomes:

```typescript
  const finishExport = (res: ExportRunResult) => {
    transferRef.current = false
    setExportProgress(null)
    if (res.canceled) return
    if (res.ok) {
      const path = res.path ?? ''
      setExportNotice({
        text: `Exported to ${path}${res.warnings.length ? ` — ${res.warnings.length} session(s) without summary: ${res.warnings.join('; ')}` : ''}`,
        ...(path ? { path } : {})
      })
      // Summarization can take minutes — announce the finish even when the
      // window is in the background. Click focuses the app (existing behavior).
      window.brain.showNotification({
        key: `export:${path}`,
        title: 'Export finished',
        body: path.split('/').pop() || path
      })
    } else {
      setExportNotice({ text: `Export failed: ${res.warnings.join('; ') || 'unknown error'}` })
    }
  }
```

4c. Wrap the remaining plain-string `setExportNotice(...)` call sites in `{ text: ... }` — there are four: the two `Import failed:` ones, and the two `Imported project/feature ...` ones. Example:

```typescript
      setExportNotice({ text: `Import failed: ${res.error ?? 'unknown error'}` })
```

The `<ExportToast ...>` render line is unchanged.

- [ ] **Step 5:** Run: `npx vitest run src/renderer/src/components/ExportToast.test.tsx && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ExportToast.tsx src/renderer/src/components/ExportToast.test.tsx src/renderer/src/App.tsx
git commit -m "feat(export): show-in-folder action and OS notification on finish

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Verify + finish

- [ ] **Step 1:** Run: `npm run typecheck && npm test` — Expected: PASS, clean tree.

- [ ] **Step 2: Manual smoke** — `npm run dev`: export a project with 2+ agent sesije; verify the bar/percentage and the list transitions (pending → spinner → ✓/✕), the OS notification on finish, and that "Show in folder" reveals the zip. Verify an import still shows its text notice.

- [ ] **Step 3:** Use superpowers:finishing-a-development-branch (default per user's workflow: `--no-ff` merge, confirm with the user before any push).

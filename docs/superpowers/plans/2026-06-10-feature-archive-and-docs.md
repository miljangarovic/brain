# Feature Archive + Feature Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Features can be archived (per-project archive with a modal) and can reference documents on disk (shown in the sidebar after the terminals).

**Architecture:** Archiving moves the `Feature` object from `group.features` to a new `group.archivedFeatures` array — everything that iterates the workspace (PTY reaper, selection, drag-drop, attention) ignores archived features for free, and the reaper kills their PTYs automatically. Restore moves it back and re-seeds App's boot/resume sets so terminals stay cold and agents resume, exactly like after an app restart. Documents are `{ id, name, path }` references on `Feature`; a new `fs:exists` IPC marks rows whose file is gone.

**Tech Stack:** Electron + React + TypeScript, vitest + @testing-library/react, electron-vite.

**Spec:** `docs/superpowers/specs/2026-06-10-feature-archive-and-docs-design.md`

**Branch:** create `feature/archive-and-docs` off `feature/export-import` — Task 11 modifies `src/main/exportImport.ts`, which only exists on that branch. (If export-import has merged to master by then, branch off master instead.)

```bash
git checkout feature/export-import && git checkout -b feature/archive-and-docs
```

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/shared/types.ts` | modify | `FeatureDoc`, `Feature.documents?`, `Group.archivedFeatures?` |
| `src/renderer/src/migrate.ts` | modify | sanitize both new fields on load/import |
| `src/renderer/src/store.ts` | modify | archive/restore/delete-archived + document ops |
| `src/main/pathsExist.ts` | create | pure existence check (testable, like `pathLinks.ts`) |
| `src/main/ipc.ts` | modify | register `IPC.fsExists` handler |
| `src/shared/api.ts` + `src/preload/index.ts` | modify | `BrainApi.pathsExist` |
| `src/renderer/src/components/icons.tsx` | modify | `DocIcon`, `ArchiveIcon` |
| `src/renderer/src/components/Sidebar.tsx` | modify | feature context menu, docs section, archive row |
| `src/renderer/src/components/ArchiveDialog.tsx` | create | per-group archive modal |
| `src/renderer/src/spawnGate.ts` | modify | `restoredSpawnIds` helper (restore = first-load rules) |
| `src/renderer/src/App.tsx` | modify | wiring: dialog state, restore refs, add-document flow, `docExists` |
| `src/main/exportImport.ts` | modify | collect agent sessions from archived features too |

Run a single test file with `npx vitest run <path>`; the whole suite with `npm test`.

---

### Task 1: Types + migration

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/migrate.ts`
- Test: `src/renderer/src/migrate.test.ts`

- [ ] **Step 1: Add the new types**

In `src/shared/types.ts`, add above `Feature`:

```ts
// A document attached to a feature: a NAMED REFERENCE to a file on disk (spec,
// plan, notes). The app never touches the file itself; a missing file just
// renders the row as broken.
export interface FeatureDoc {
  id: string
  name: string   // display name; defaults to the file's basename
  path: string   // absolute path on disk
}
```

Add to `Feature` (after `terminals: Terminal[]`):

```ts
  documents?: FeatureDoc[]     // undefined === []
```

Add to `Group` (after `features: Feature[]`):

```ts
  // Features moved out of the active list. Their terminals are not part of the
  // workspace tree, so their PTYs are dead while archived; restore re-adds them
  // to `features` and they spawn like terminals restored at app boot.
  archivedFeatures?: Feature[] // undefined === []
```

- [ ] **Step 2: Write the failing migrate tests**

Append to `src/renderer/src/migrate.test.ts` (inside the existing top-level describe, or as a new `describe`):

```ts
describe('archive + documents migration', () => {
  it('sanitizes archivedFeatures like active features and drops garbage entries', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [], archivedFeatures: [
      { id: 'af', name: 'old', collapsed: false, terminals: [{ id: 't', name: 's', cwd: '' }] },
      'garbage', null
    ] }] })
    expect(ws.groups[0].archivedFeatures).toHaveLength(1)
    expect(ws.groups[0].archivedFeatures![0].name).toBe('old')
    expect(ws.groups[0].archivedFeatures![0].terminals).toHaveLength(1)
  })

  it('omits archivedFeatures when absent or empty after sanitizing', () => {
    expect(migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [] }] })
      .groups[0].archivedFeatures).toBeUndefined()
    expect(migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [], archivedFeatures: ['x'] }] })
      .groups[0].archivedFeatures).toBeUndefined()
  })

  it('sanitizes feature documents: fills ids/names, drops entries without a path', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [
      { id: 'f', name: 'auth', collapsed: false, terminals: [], documents: [
        { name: 'spec', path: '/docs/spec.md' },
        { path: '/docs/plan.md' },
        { name: 'no-path' },
        'garbage'
      ] }
    ] }] })
    const docs = ws.groups[0].features[0].documents!
    expect(docs).toHaveLength(2)
    expect(docs[0]).toMatchObject({ name: 'spec', path: '/docs/spec.md' })
    expect(docs[0].id).toBeTruthy()
    expect(docs[1].name).toBe('plan.md') // basename fallback
  })

  it('omits documents when the sanitized list is empty', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [
      { id: 'f', name: 'auth', collapsed: false, terminals: [], documents: ['junk'] }
    ] }] })
    expect(ws.groups[0].features[0].documents).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/migrate.test.ts`
Expected: the four new tests FAIL (archivedFeatures dropped entirely; raw documents kept unsanitized).

- [ ] **Step 4: Implement the migration**

In `src/renderer/src/migrate.ts`:

Change the import to include `FeatureDoc`:

```ts
import { Workspace, Group, Feature, Terminal, FeatureDoc } from '@shared/types'
```

Add below `sanitizeTerminal`:

```ts
// A document reference is only useful with a path; entries without one are
// dropped. Missing ids/names are filled (name falls back to the file's basename).
function sanitizeDoc(dv: unknown): FeatureDoc | null {
  if (!isObj(dv)) return null
  const d = dv as unknown as FeatureDoc
  if (typeof d.path !== 'string' || !d.path) return null
  return { id: str(d.id, createId()), name: str(d.name, d.path.split('/').pop() || 'doc'), path: d.path }
}
```

Replace `sanitizeFeature` with (the raw `documents` must not survive the `...f` spread):

```ts
function sanitizeFeature(fv: unknown): Feature | null {
  if (!isObj(fv)) return null
  const f = fv as unknown as Feature
  const { documents: _rawDocs, ...rest } = f
  const docs = (Array.isArray(f.documents) ? f.documents : []).map(sanitizeDoc).filter((d): d is FeatureDoc => d !== null)
  return {
    ...rest,
    id: str(f.id, createId()),
    name: str(f.name, 'general'),
    collapsed: !!f.collapsed,
    terminals: (Array.isArray(f.terminals) ? f.terminals : []).map(sanitizeTerminal).filter((t): t is Terminal => t !== null),
    ...(docs.length > 0 ? { documents: docs } : {})
  }
}
```

In `migrateWorkspace`, replace the `if (Array.isArray(g.features))` branch body with:

```ts
    if (Array.isArray(g.features)) {
      const archived = (Array.isArray(g.archivedFeatures) ? g.archivedFeatures : [])
        .map(sanitizeFeature).filter((f): f is Feature => f !== null)
      return {
        id, name, cwd, collapsed,
        features: g.features.map(sanitizeFeature).filter((f): f is Feature => f !== null),
        ...(archived.length > 0 ? { archivedFeatures: archived } : {})
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/migrate.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/src/migrate.ts src/renderer/src/migrate.test.ts
git commit -m "feat(types): FeatureDoc + Group.archivedFeatures, with load-time sanitizing"
```

---

### Task 2: Store — archive / restore / delete-archived

**Files:**
- Modify: `src/renderer/src/store.ts`
- Test: `src/renderer/src/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/store.test.ts`. Extend the import from `./store` with `archiveFeature, restoreFeature, deleteArchivedFeature` (and later in Task 3 `addDocument, renameDocument, removeDocument`).

```ts
describe('feature archive', () => {
  // group with two features: f0 'general' (default) + 'auth'; one terminal in 'auth'
  const setup = () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const gid = s.workspace.groups[0].id
    s = addFeature(s, gid, 'auth')
    const fid = s.workspace.groups[0].features[1].id
    s = addTerminal(s, fid, { name: 'term' })
    return { s, gid, fid }
  }

  it('archiveFeature moves the feature into group.archivedFeatures', () => {
    const { s, fid } = setup()
    const out = archiveFeature(s, fid)
    const g = out.workspace.groups[0]
    expect(g.features.map((f) => f.name)).toEqual(['general'])
    expect(g.archivedFeatures!.map((f) => f.name)).toEqual(['auth'])
    expect(g.archivedFeatures![0].terminals).toHaveLength(1) // terminals ride along
  })

  it('archived terminals leave allTerminals (so the PTY reaper kills them)', () => {
    const { s, fid } = setup()
    expect(allTerminals(s)).toHaveLength(1)
    expect(allTerminals(archiveFeature(s, fid))).toHaveLength(0)
  })

  it('archiving the active feature reselects within the group; activeGroupId untouched', () => {
    const { s, gid, fid } = setup() // addTerminal made 'auth' + its terminal active
    const out = archiveFeature(s, fid)
    expect(out.activeGroupId).toBe(gid)
    expect(out.activeFeatureId).toBe(out.workspace.groups[0].features[0].id) // 'general'
    expect(out.activeTerminalId).toBeNull() // 'general' has no terminals
  })

  it('archiving the last active feature leaves null feature/terminal selection', () => {
    let { s, fid } = setup()
    const generalId = s.workspace.groups[0].features[0].id
    s = archiveFeature(s, generalId)
    const out = archiveFeature(s, fid)
    expect(out.workspace.groups[0].features).toHaveLength(0)
    expect(out.activeFeatureId).toBeNull()
    expect(out.activeTerminalId).toBeNull()
    expect(out.activeGroupId).toBe(out.workspace.groups[0].id)
  })

  it('archiving a non-active feature leaves selection untouched', () => {
    const { s, fid } = setup()
    const generalId = s.workspace.groups[0].features[0].id
    const out = archiveFeature(s, generalId)
    expect(out.activeFeatureId).toBe(fid)
    expect(out.activeTerminalId).toBe(s.activeTerminalId)
  })

  it('archiveFeature prunes the feature terminals from hidden', () => {
    let { s, fid } = setup()
    const tid = s.workspace.groups[0].features[1].terminals[0].id
    s = hideTerminal(s, tid)
    expect(isHidden(s, tid)).toBe(true)
    expect(isHidden(archiveFeature(s, fid), tid)).toBe(false)
  })

  it('restoreFeature appends to the END of active features and keeps selection', () => {
    let { s, fid } = setup()
    s = archiveFeature(s, fid)
    const before = { f: s.activeFeatureId, t: s.activeTerminalId }
    const out = restoreFeature(s, fid)
    const g = out.workspace.groups[0]
    expect(g.features.map((f) => f.name)).toEqual(['general', 'auth'])
    expect(g.archivedFeatures).toHaveLength(0)
    expect(g.features[1].terminals).toHaveLength(1)
    expect(out.activeFeatureId).toBe(before.f)
    expect(out.activeTerminalId).toBe(before.t)
  })

  it('deleteArchivedFeature removes it permanently', () => {
    let { s, fid } = setup()
    s = archiveFeature(s, fid)
    const out = deleteArchivedFeature(s, fid)
    expect(out.workspace.groups[0].archivedFeatures).toHaveLength(0)
    expect(out.workspace.groups[0].features.map((f) => f.name)).toEqual(['general'])
  })

  it('archiveFeature / restoreFeature are no-ops for unknown ids', () => {
    const { s } = setup()
    expect(archiveFeature(s, 'nope')).toBe(s)
    expect(restoreFeature(s, 'nope')).toBe(s)
    expect(deleteArchivedFeature(s, 'nope')).toBe(s)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: FAIL — `archiveFeature` is not exported.

- [ ] **Step 3: Implement the archive operations**

In `src/renderer/src/store.ts`, add a helper next to `groupOfFeature`:

```ts
const groupOfArchived = (ws: Workspace, featureId: string): Group | undefined =>
  ws.groups.find((g) => (g.archivedFeatures ?? []).some((f) => f.id === featureId))
```

Add a new section after the `// ---- features ---` block:

```ts
// ---- archive ---------------------------------------------------------------
// Move a feature out of the active list into its group's archive. Its terminals
// leave the workspace tree, so the PTY reaper kills their processes. Selection
// follows the deleteFeature rule when the archived feature was active;
// activeGroupId is untouched (the active feature is always in the active group).
export function archiveFeature(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId)
  if (!group || !feature) return state
  const ws = mapGroup(state.workspace, group.id, (g) => ({
    ...g,
    features: g.features.filter((f) => f.id !== featureId),
    archivedFeatures: [...(g.archivedFeatures ?? []), feature]
  }))
  const termIds = new Set(feature.terminals.map((t) => t.id))
  const hidden = state.hidden.filter((id) => !termIds.has(id))
  let { activeFeatureId, activeTerminalId } = state
  if (activeFeatureId === featureId) {
    const g2 = ws.groups.find((g) => g.id === group.id) ?? null
    const sel = selectFeature(g2, hidden)
    activeFeatureId = sel.featureId
    activeTerminalId = sel.terminalId
  }
  return { ...state, workspace: ws, activeFeatureId, activeTerminalId, hidden }
}

// Move an archived feature back to the END of its group's active list. The
// active selection is untouched — the archive dialog stays open for more moves.
// The caller (App) re-seeds the boot/resume spawn sets for its terminals.
export function restoreFeature(state: AppState, featureId: string): AppState {
  const group = groupOfArchived(state.workspace, featureId)
  const feature = group?.archivedFeatures?.find((f) => f.id === featureId)
  if (!group || !feature) return state
  return {
    ...state,
    workspace: mapGroup(state.workspace, group.id, (g) => ({
      ...g,
      features: [...g.features, feature],
      archivedFeatures: (g.archivedFeatures ?? []).filter((f) => f.id !== featureId)
    }))
  }
}

// Permanently delete a feature from the archive (the UI confirms first).
export function deleteArchivedFeature(state: AppState, featureId: string): AppState {
  const group = groupOfArchived(state.workspace, featureId)
  if (!group) return state
  return {
    ...state,
    workspace: mapGroup(state.workspace, group.id, (g) => ({
      ...g,
      archivedFeatures: (g.archivedFeatures ?? []).filter((f) => f.id !== featureId)
    }))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(store): archive / restore / permanently delete features"
```

---

### Task 3: Store — document operations

**Files:**
- Modify: `src/renderer/src/store.ts`
- Test: `src/renderer/src/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/store.test.ts` (extend the `./store` import with `addDocument, renameDocument, removeDocument`):

```ts
describe('feature documents', () => {
  const setup = () => {
    const s = addGroup(createInitialState(), 'proj', '/p')
    return { s, fid: s.workspace.groups[0].features[0].id }
  }
  const docsOf = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0].features[0].documents

  it('addDocument appends a doc with the given id/name/path', () => {
    const { s, fid } = setup()
    const out = addDocument(s, fid, { id: 'd1', name: 'spec.md', path: '/p/spec.md' })
    expect(docsOf(out)).toEqual([{ id: 'd1', name: 'spec.md', path: '/p/spec.md' }])
  })

  it('addDocument generates an id when none is given', () => {
    const { s, fid } = setup()
    const out = addDocument(s, fid, { name: 'spec.md', path: '/p/spec.md' })
    expect(docsOf(out)![0].id).toBeTruthy()
  })

  it('addDocument with an already-referenced path is a no-op', () => {
    let { s, fid } = setup()
    s = addDocument(s, fid, { name: 'spec.md', path: '/p/spec.md' })
    const out = addDocument(s, fid, { name: 'again', path: '/p/spec.md' })
    expect(out).toBe(s)
  })

  it('renameDocument / removeDocument target the doc by id; the path is untouched', () => {
    let { s, fid } = setup()
    s = addDocument(s, fid, { id: 'd1', name: 'spec.md', path: '/p/spec.md' })
    s = addDocument(s, fid, { id: 'd2', name: 'plan.md', path: '/p/plan.md' })
    s = renameDocument(s, fid, 'd1', 'Spec')
    expect(docsOf(s)![0]).toEqual({ id: 'd1', name: 'Spec', path: '/p/spec.md' })
    s = removeDocument(s, fid, 'd1')
    expect(docsOf(s)!.map((d) => d.id)).toEqual(['d2'])
  })

  it('document ops on an archived feature are no-ops (active features only)', () => {
    let { s, fid } = setup()
    s = addDocument(s, fid, { id: 'd1', name: 'spec.md', path: '/p/spec.md' })
    s = archiveFeature(s, fid)
    expect(addDocument(s, fid, { name: 'x', path: '/x' })).toBe(s)
    expect(renameDocument(s, fid, 'd1', 'X').workspace).toEqual(s.workspace)
    expect(removeDocument(s, fid, 'd1').workspace).toEqual(s.workspace)
    // the archived feature still carries its documents
    expect(s.workspace.groups[0].archivedFeatures![0].documents).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: FAIL — `addDocument` is not exported.

- [ ] **Step 3: Implement the document operations**

In `src/renderer/src/store.ts`: extend the `@shared/types` import with `FeatureDoc`, then add a new section after the archive section:

```ts
// ---- documents -------------------------------------------------------------
// Documents are named references to files on disk; the file itself is never
// touched. All three operate on ACTIVE features only — an archived feature's
// documents ride along untouched until restore (mapFeature walks g.features).
export function addDocument(state: AppState, featureId: string, input: { name: string; path: string; id?: string }): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId)
  if (!feature) return state
  if ((feature.documents ?? []).some((d) => d.path === input.path)) return state // duplicate path: no-op
  const doc: FeatureDoc = { id: input.id ?? createId(), name: input.name, path: input.path }
  return { ...state, workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, documents: [...(f.documents ?? []), doc] })) }
}

export function renameDocument(state: AppState, featureId: string, docId: string, name: string): AppState {
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({
      ...f, documents: (f.documents ?? []).map((d) => (d.id === docId ? { ...d, name } : d))
    }))
  }
}

export function removeDocument(state: AppState, featureId: string, docId: string): AppState {
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({
      ...f, documents: (f.documents ?? []).filter((d) => d.id !== docId)
    }))
  }
}
```

Note: `renameDocument`/`removeDocument` on a feature with no matching doc produce an equal-but-new workspace object — that is consistent with how `renameTerminal` behaves and is fine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(store): feature document references (add/rename/remove)"
```

---

### Task 4: `pathsExist` — main helper, IPC, preload

**Files:**
- Create: `src/main/pathsExist.ts`
- Test: `src/main/pathsExist.test.ts`
- Modify: `src/main/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/pathsExist.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathsExist } from './pathsExist'

describe('pathsExist', () => {
  it('returns index-aligned booleans; errors read as false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-exists-'))
    const real = join(dir, 'spec.md')
    writeFileSync(real, '# spec')
    await expect(pathsExist([real, join(dir, 'missing.md'), real])).resolves.toEqual([true, false, true])
  })

  it('handles the empty list', async () => {
    await expect(pathsExist([])).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/pathsExist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/main/pathsExist.ts`:

```ts
import { promises as fsp } from 'fs'

// Index-aligned existence check for the renderer's document rows. Any access
// error (missing, permission) reads as "does not exist" — the UI only dims the row.
export function pathsExist(paths: string[]): Promise<boolean[]> {
  return Promise.all(paths.map((p) => fsp.access(p).then(() => true, () => false)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/pathsExist.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire IPC, API, preload**

In `src/main/ipc.ts`, add the import and register the handler right after the `IPC.fsRead` handler:

```ts
import { pathsExist } from './pathsExist'
```

```ts
  // Document rows in the sidebar: which referenced files still exist on disk.
  ipcMain.handle(IPC.fsExists, (_e, p: { paths: string[] }) => pathsExist(p?.paths ?? []))
```

In `src/shared/api.ts`, add to `BrainApi` (after `resolvePathLinks`):

```ts
  // Index-aligned: true where the path exists on disk (feature document rows).
  pathsExist(paths: string[]): Promise<boolean[]>
```

In `src/preload/index.ts`, add to the `api` object:

```ts
  pathsExist: (paths) => ipcRenderer.invoke(IPC.fsExists, { paths }) as Promise<boolean[]>,
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: clean typecheck, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/pathsExist.ts src/main/pathsExist.test.ts src/main/ipc.ts src/shared/api.ts src/preload/index.ts
git commit -m "feat(ipc): fs:exists — batch path existence for document rows"
```

---

### Task 5: Icons — `DocIcon`, `ArchiveIcon`

**Files:**
- Modify: `src/renderer/src/components/icons.tsx`
- Test: `src/renderer/src/components/icons.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/components/icons.test.tsx` (match the file's existing render/assert style; `DocIcon`/`ArchiveIcon` join the existing import from `./icons`):

```tsx
it('DocIcon and ArchiveIcon render with their test ids', () => {
  render(<><DocIcon /><ArchiveIcon /></>)
  expect(screen.getByTestId('icon-doc')).toBeInTheDocument()
  expect(screen.getByTestId('icon-archive')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/icons.test.tsx`
Expected: FAIL — `DocIcon` is not exported.

- [ ] **Step 3: Implement the icons**

Append to `src/renderer/src/components/icons.tsx`:

```tsx
export function DocIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-doc" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  )
}

export function ArchiveIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-archive" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/icons.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/icons.tsx src/renderer/src/components/icons.test.tsx
git commit -m "feat(icons): DocIcon + ArchiveIcon"
```

---

### Task 6: Sidebar — feature context menu

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Test: `src/renderer/src/components/Sidebar.test.tsx`

New props in this task: `onArchiveFeature(featureId)`, `onAddDocument(featureId)`. (`onLaunchAgent`/`onAddTerminal` already exist and are reused.)

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/components/Sidebar.test.tsx`, and add to the `renderSidebar` props factory:

```ts
    onArchiveFeature: noop,
    onAddDocument: noop,
```

```tsx
describe('feature context menu', () => {
  it('right-click on a feature opens Rename / New agents / Add document / Archive', () => {
    renderSidebar()
    fireEvent.contextMenu(screen.getByText('auth'))
    for (const label of ['Rename', 'New Claude', 'New Codex', 'New Terminal', 'Add document…', 'Archive'])
      expect(screen.getByRole('menuitem', { name: new RegExp(label.replace('…', '')) })).toBeInTheDocument()
  })

  it('Archive calls onArchiveFeature with the feature id', async () => {
    const onArchiveFeature = vi.fn()
    renderSidebar({ onArchiveFeature })
    fireEvent.contextMenu(screen.getByText('auth'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(onArchiveFeature).toHaveBeenCalledWith('f1')
  })

  it('New Codex launches an agent; Add document calls onAddDocument', async () => {
    const onLaunchAgent = vi.fn()
    const onAddDocument = vi.fn()
    renderSidebar({ onLaunchAgent, onAddDocument })
    fireEvent.contextMenu(screen.getByText('auth'))
    await userEvent.click(screen.getByRole('menuitem', { name: /New Codex/ }))
    expect(onLaunchAgent).toHaveBeenCalledWith('f1', 'codex')
    fireEvent.contextMenu(screen.getByText('auth'))
    await userEvent.click(screen.getByRole('menuitem', { name: /Add document/ }))
    expect(onAddDocument).toHaveBeenCalledWith('f1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: the new tests FAIL (no context menu opens on a feature row).

- [ ] **Step 3: Implement the menu**

In `src/renderer/src/components/Sidebar.tsx`:

Extend the icons import:

```ts
import { TerminalKindIcon, GridIcon, TrashIcon, SpinnerIcon, ClaudeIcon, CodexIcon, ShellIcon, DocIcon, ArchiveIcon } from './icons'
```

Add the two props to the `Sidebar` props type (next to `onDeleteFeature`) and to the destructuring:

```ts
  onArchiveFeature: (id: string) => void
  onAddDocument: (featureId: string) => void
```

Add menu state next to the existing `menu`/`termMenu`:

```ts
  const [featMenu, setFeatMenu] = useState<{ x: number; y: number; featureId: string } | null>(null)
```

On the feature row `div` (the one with `data-feature-id={f.id}`), add after `onDragEnd={clearDrag}`:

```tsx
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setFeatMenu({ x: e.clientX, y: e.clientY, featureId: f.id }) }}
```

(`stopPropagation` keeps a future group-level contextmenu from double-handling.)

Render the menu next to the existing `{menu && ...}` / `{termMenu && ...}` blocks:

```tsx
      {featMenu && (() => {
        const f = groups.flatMap((g) => g.features).find((x) => x.id === featMenu.featureId)
        if (!f) return null
        return (
          <ContextMenu x={featMenu.x} y={featMenu.y} onClose={() => setFeatMenu(null)} items={[
            { label: 'Rename', onSelect: () => startRename('feature', f.id, f.name) },
            { label: 'New Claude', icon: <ClaudeIcon />, onSelect: () => onLaunchAgent(f.id, 'claude') },
            { label: 'New Codex', icon: <CodexIcon />, onSelect: () => onLaunchAgent(f.id, 'codex') },
            { label: 'New Terminal', icon: <ShellIcon className="text-fg-muted" />, onSelect: () => onAddTerminal(f.id) },
            { label: 'Add document…', icon: <DocIcon />, onSelect: () => onAddDocument(f.id) },
            { label: 'Archive', icon: <ArchiveIcon />, onSelect: () => onArchiveFeature(f.id) }
          ]} />
        )
      })()}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: PASS.

> **Note:** `npm run typecheck` goes RED from this task until Task 11 — Sidebar gains
> required props that App only passes in the App-wiring task. That is expected;
> vitest still passes (it transpiles without typechecking). Don't "fix" it by making
> the props optional.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): feature context menu — rename, new terminal/agents, add document, archive"
```

---

### Task 7: Sidebar — documents section

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Test: `src/renderer/src/components/Sidebar.test.tsx`

New props: `onOpenDocument(path)`, `onRenameDocument(featureId, docId, name)`, `onRemoveDocument(featureId, docId)`, `docExists: Record<string, boolean | undefined>`, `pendingRenameDocId?`, `onPendingRenameDocConsumed?`. Existence is computed in App (Task 10) and passed down — the Sidebar stays prop-driven; a path missing from `docExists` is treated as existing (check still in flight).

- [ ] **Step 1: Write the failing tests**

In `Sidebar.test.tsx`: give feature `f1` documents in the fixture —

```ts
    { id: 'f1', name: 'auth', collapsed: false, terminals: [
      { id: 't1', name: 'claude', cwd: '/home/me/proj', kind: 'claude' }
    ], documents: [
      { id: 'd1', name: 'spec', path: '/docs/spec.md' },
      { id: 'd2', name: 'plan', path: '/docs/plan.md' }
    ] },
```

Add to the `renderSidebar` props factory:

```ts
    onOpenDocument: noop,
    onRenameDocument: noop,
    onRemoveDocument: noop,
    docExists: {},
```

Append tests:

```tsx
describe('feature documents section', () => {
  it('renders document rows after the terminals; click opens the file', async () => {
    const onOpenDocument = vi.fn()
    renderSidebar({ onOpenDocument })
    const spec = screen.getByText('spec').closest('[data-doc-id]') as HTMLElement
    expect(spec).toBeInTheDocument()
    // docs come after the terminal rows in document order
    const term = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(term.compareDocumentPosition(spec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(screen.getByText('spec'))
    expect(onOpenDocument).toHaveBeenCalledWith('/docs/spec.md')
  })

  it('a missing file renders broken and does not open', async () => {
    const onOpenDocument = vi.fn()
    renderSidebar({ onOpenDocument, docExists: { '/docs/spec.md': false, '/docs/plan.md': true } })
    const row = screen.getByText('spec').closest('[data-doc-id]') as HTMLElement
    expect(row.className).toContain('line-through')
    await userEvent.click(screen.getByText('spec'))
    expect(onOpenDocument).not.toHaveBeenCalled()
  })

  it('double-click renames; Enter commits via onRenameDocument', async () => {
    const onRenameDocument = vi.fn()
    renderSidebar({ onRenameDocument })
    await userEvent.dblClick(screen.getByText('spec'))
    const input = screen.getByLabelText('Rename document spec')
    await userEvent.clear(input)
    await userEvent.type(input, 'Spec v2{Enter}')
    expect(onRenameDocument).toHaveBeenCalledWith('f1', 'd1', 'Spec v2')
  })

  it('the trash button removes the reference', async () => {
    const onRemoveDocument = vi.fn()
    renderSidebar({ onRemoveDocument })
    await userEvent.click(screen.getByLabelText('Remove document spec'))
    expect(onRemoveDocument).toHaveBeenCalledWith('f1', 'd1')
  })

  it('pendingRenameDocId opens the rename input and is consumed', () => {
    const onPendingRenameDocConsumed = vi.fn()
    renderSidebar({ pendingRenameDocId: 'd2', onPendingRenameDocConsumed })
    expect(screen.getByLabelText('Rename document plan')).toBeInTheDocument()
    expect(onPendingRenameDocConsumed).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: the new tests FAIL (no document rows rendered).

- [ ] **Step 3: Implement the section**

In `Sidebar.tsx`:

1. Extend `RenameKind`:

```ts
type RenameKind = 'group' | 'feature' | 'terminal' | 'doc'
```

2. Add the props (type + destructuring):

```ts
  onOpenDocument: (path: string) => void
  onRenameDocument: (featureId: string, docId: string, name: string) => void
  onRemoveDocument: (featureId: string, docId: string) => void
  docExists: Record<string, boolean | undefined>
  pendingRenameDocId?: string | null
  onPendingRenameDocConsumed?: () => void
```

3. In `commitRename`, extend the dispatch — a doc's feature is found by scanning (doc ids are unique):

```ts
      if (editing.kind === 'group') onRenameGroup(editing.id, name)
      else if (editing.kind === 'feature') onRenameFeature(editing.id, name)
      else if (editing.kind === 'doc') {
        const f = groups.flatMap((g) => g.features).find((f) => (f.documents ?? []).some((d) => d.id === editing.id))
        if (f) onRenameDocument(f.id, editing.id, name)
      }
      else onRenameTerminal(editing.id, name)
```

4. Mirror the pending-rename effect (place it right after the terminal one):

```ts
  // A freshly-added document asks (via prop) to immediately open its rename input.
  useEffect(() => {
    if (!pendingRenameDocId) return
    const d = groups.flatMap((g) => g.features).flatMap((f) => f.documents ?? []).find((d) => d.id === pendingRenameDocId)
    if (d) {
      startRename('doc', d.id, d.name)
      onPendingRenameDocConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRenameDocId])
```

5. Render the docs block directly AFTER the terminals container (the `</div>` closing `data-feature-terminals`), still inside the `{!f.collapsed && (...)}'s parent — i.e. change the structure to:

```tsx
                    {!f.collapsed && (
                      <>
                        <div
                          className="ml-[18px] border-l border-divider pl-0.5"
                          data-feature-terminals={f.id}
                        >
                          {/* ...existing terminal rows, unchanged... */}
                        </div>
                        {(f.documents ?? []).length > 0 && (
                          <div className="ml-[18px] border-l border-divider pl-0.5">
                            {(f.documents ?? []).map((d) => {
                              const broken = docExists[d.path] === false
                              return (
                                <div key={d.id} data-doc-id={d.id}
                                  onClick={() => { if (!broken) onOpenDocument(d.path) }}
                                  title={broken ? `${d.path} (missing)` : d.path}
                                  className={`relative group mx-1 my-[2px] flex items-center gap-1.5 rounded-md pl-2 pr-1.5 py-[2px] text-[13px] cursor-pointer transition-colors hover:bg-hover ${broken ? 'text-fg-muted line-through' : 'text-fg hover:text-fg-bright'}`}>
                                  <DocIcon className="shrink-0 text-fg-muted" />
                                  {isEditing('doc', d.id)
                                    ? renameInput(`Rename document ${d.name}`)
                                    : (
                                      <span className="flex-1 truncate"
                                        onDoubleClick={(e) => { e.stopPropagation(); startRename('doc', d.id, d.name) }}>
                                        {d.name}
                                      </span>
                                    )}
                                  {!isEditing('doc', d.id) && (
                                    <button aria-label={`Remove document ${d.name}`} title="Remove document"
                                      onClick={(e) => { e.stopPropagation(); onRemoveDocument(f.id, d.id) }}
                                      className={`${hoverBtn} text-base leading-none hover:text-danger`}><TrashIcon /></button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
```

Document rows are NOT draggable and carry no `data-term-id`, so the existing drag-drop midpoint queries ignore them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: PASS (new + all pre-existing, including drag-drop tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): per-feature documents section after the terminals"
```

---

### Task 8: Sidebar — archive row

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Test: `src/renderer/src/components/Sidebar.test.tsx`

New prop: `onOpenArchive(groupId)`.

- [ ] **Step 1: Write the failing tests**

Add `onOpenArchive: noop,` to the `renderSidebar` factory, then append:

```tsx
describe('archive row', () => {
  it('shows the per-group archived count and opens the archive', async () => {
    const onOpenArchive = vi.fn()
    const withArchive: Group[] = [{
      ...groups[0],
      archivedFeatures: [{ id: 'fa', name: 'old', collapsed: false, terminals: [] }]
    }]
    renderSidebar({ groups: withArchive, onOpenArchive })
    const row = screen.getByLabelText('Archive of proj')
    expect(row).toHaveTextContent('Archive (1)')
    await userEvent.click(row)
    expect(onOpenArchive).toHaveBeenCalledWith('g1')
  })

  it('is visible with count 0 when nothing is archived', () => {
    renderSidebar()
    expect(screen.getByLabelText('Archive of proj')).toHaveTextContent('Archive (0)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the row**

Add the prop `onOpenArchive: (groupId: string) => void` (type + destructuring). In the group features container, directly after the `+ Feature` input's wrapping `<div className="px-2 pt-1 pb-1">...</div>`, add:

```tsx
                <button
                  aria-label={`Archive of ${g.name}`}
                  onClick={() => onOpenArchive(g.id)}
                  className="mx-1 mb-1 flex items-center gap-1.5 rounded-md px-2 py-[2px] text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <ArchiveIcon className="shrink-0" />
                  Archive ({(g.archivedFeatures ?? []).length})
                </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): per-project Archive (N) row"
```

---

### Task 9: ArchiveDialog

**Files:**
- Create: `src/renderer/src/components/ArchiveDialog.tsx`
- Test: `src/renderer/src/components/ArchiveDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/components/ArchiveDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArchiveDialog } from './ArchiveDialog'
import type { Group } from '@shared/types'

const group: Group = {
  id: 'g1', name: 'proj', cwd: '/p', collapsed: false,
  features: [
    { id: 'f1', name: 'auth', collapsed: false, terminals: [{ id: 't1', name: 's', cwd: '/p' }] }
  ],
  archivedFeatures: [
    { id: 'fa', name: 'old-ui', collapsed: false, terminals: [] }
  ]
}
const noop = () => {}

function renderDialog(overrides: Partial<Parameters<typeof ArchiveDialog>[0]> = {}) {
  const props = { group, onArchive: noop, onRestore: noop, onDeleteArchived: noop, onClose: noop, ...overrides }
  return render(<ArchiveDialog {...props} />)
}

describe('ArchiveDialog', () => {
  it('lists active and archived features with terminal counts', () => {
    renderDialog()
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByText('1 terminal')).toBeInTheDocument()
    expect(screen.getByText('old-ui')).toBeInTheDocument()
    expect(screen.getByText('0 terminals')).toBeInTheDocument()
  })

  it('Archive / Restore / trash call up with the feature id', async () => {
    const onArchive = vi.fn(); const onRestore = vi.fn(); const onDeleteArchived = vi.fn()
    renderDialog({ onArchive, onRestore, onDeleteArchived })
    await userEvent.click(screen.getByLabelText('Archive feature auth'))
    expect(onArchive).toHaveBeenCalledWith('f1')
    await userEvent.click(screen.getByLabelText('Restore feature old-ui'))
    expect(onRestore).toHaveBeenCalledWith('fa')
    await userEvent.click(screen.getByLabelText('Delete archived feature old-ui'))
    expect(onDeleteArchived).toHaveBeenCalledWith('fa')
  })

  it('shows empty-state lines when a section has no features', () => {
    renderDialog({ group: { ...group, features: [], archivedFeatures: [] } })
    expect(screen.getByText('No active features.')).toBeInTheDocument()
    expect(screen.getByText('Nothing archived yet.')).toBeInTheDocument()
  })

  it('closes on Escape, the X button, and a backdrop click — but not an inner click', async () => {
    const onClose = vi.fn()
    const { container } = renderDialog({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByLabelText('Close archive'))
    expect(onClose).toHaveBeenCalledTimes(2)
    await userEvent.click(container.firstChild as HTMLElement) // backdrop
    expect(onClose).toHaveBeenCalledTimes(3)
    await userEvent.click(screen.getByText('auth'))            // inner content
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/ArchiveDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dialog**

Create `src/renderer/src/components/ArchiveDialog.tsx` (same backdrop/Escape pattern as `NewGroupDialog`/`ConfirmDialog`; the parent keeps it mounted across actions, so the lists live-update from the `group` prop):

```tsx
import { useEffect } from 'react'
import type { Group } from '@shared/types'
import { TrashIcon } from './icons'

export function ArchiveDialog({
  group, onArchive, onRestore, onDeleteArchived, onClose
}: {
  group: Group
  onArchive: (featureId: string) => void
  onRestore: (featureId: string) => void
  onDeleteArchived: (featureId: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const archived = group.archivedFeatures ?? []
  const row = 'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover'
  const heading = 'mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted'
  const actionBtn = 'shrink-0 rounded-md px-2.5 py-1 text-xs text-fg ring-1 ring-line hover:bg-hover transition-colors'
  const count = (n: number) => `${n} terminal${n === 1 ? '' : 's'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[28rem] max-h-[70vh] overflow-y-auto rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-fg-bright">Archive — {group.name}</h2>
          <button aria-label="Close archive" onClick={onClose}
            className="rounded-md px-2 py-0.5 text-fg-muted transition-colors hover:bg-hover hover:text-fg">✕</button>
        </div>

        <h3 className={heading}>Active</h3>
        {group.features.length === 0 && <p className="px-2 py-1 text-sm text-fg-muted">No active features.</p>}
        {group.features.map((f) => (
          <div key={f.id} className={row}>
            <span className="flex-1 truncate text-sm text-fg">{f.name}</span>
            <span className="shrink-0 text-xs text-fg-muted">{count(f.terminals.length)}</span>
            <button aria-label={`Archive feature ${f.name}`} onClick={() => onArchive(f.id)} className={actionBtn}>Archive</button>
          </div>
        ))}

        <h3 className={`mt-4 ${heading}`}>Archived</h3>
        {archived.length === 0 && <p className="px-2 py-1 text-sm text-fg-muted">Nothing archived yet.</p>}
        {archived.map((f) => (
          <div key={f.id} className={row}>
            <span className="flex-1 truncate text-sm text-fg">{f.name}</span>
            <span className="shrink-0 text-xs text-fg-muted">{count(f.terminals.length)}</span>
            <button aria-label={`Restore feature ${f.name}`} onClick={() => onRestore(f.id)} className={actionBtn}>Restore</button>
            <button aria-label={`Delete archived feature ${f.name}`} title="Delete permanently"
              onClick={() => onDeleteArchived(f.id)}
              className="shrink-0 rounded-md px-1.5 py-1 text-base leading-none text-fg-muted transition-colors hover:bg-hover hover:text-danger"><TrashIcon /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/ArchiveDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ArchiveDialog.tsx src/renderer/src/components/ArchiveDialog.test.tsx
git commit -m "feat(archive): per-project archive dialog — archive, restore, delete permanently"
```

---

### Task 10: Restore spawn semantics — `restoredSpawnIds`

**Files:**
- Modify: `src/renderer/src/spawnGate.ts`
- Test: `src/renderer/src/spawnGate.test.ts`

The spec calls for an App-level test that restored agents resume. There is no App.tsx test harness in this repo (App mounts xterm/PTYs), so the testable logic — WHICH ids join the boot/resume sets — lives in `spawnGate.ts` as a pure helper with unit tests, and App's wiring (Task 11) reduces to applying it. This is the same pattern `shouldSpawn` already uses.

- [ ] **Step 1: Write the failing test**

Append to `src/renderer/src/spawnGate.test.ts` (extend the `./spawnGate` import with `restoredSpawnIds`):

```ts
import type { Feature } from '@shared/types'

describe('restoredSpawnIds', () => {
  const feature: Feature = {
    id: 'f', name: 'auth', collapsed: false, terminals: [
      { id: 'tc', name: 'claude', cwd: '/p', kind: 'claude', sessionId: 'cs-1' },
      { id: 'tx', name: 'codex', cwd: '/p', kind: 'codex' },
      { id: 'ts', name: 'shell', cwd: '/p' }
    ]
  }
  it('all terminals go cold (boot); agent terminals also resume', () => {
    expect(restoredSpawnIds(feature)).toEqual({
      bootIds: ['tc', 'tx', 'ts'],
      resumeIds: ['tc', 'tx']
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/spawnGate.test.ts`
Expected: FAIL — `restoredSpawnIds` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/renderer/src/spawnGate.ts`, add:

```ts
import type { Feature } from '@shared/types'

// Ids a feature restored from the archive contributes to App's spawn-control
// sets — the same rules as terminals restored from disk at boot: every terminal
// goes back to "cold until opened", and agent terminals spawn with their resume
// command. (Resume eligibility matches the initial-load rule: agent kind alone;
// a missing sessionId falls back to --continue / resume --last at spawn.)
export function restoredSpawnIds(feature: Feature): { bootIds: string[]; resumeIds: string[] } {
  return {
    bootIds: feature.terminals.map((t) => t.id),
    resumeIds: feature.terminals.filter((t) => t.kind === 'claude' || t.kind === 'codex').map((t) => t.id)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/spawnGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/spawnGate.ts src/renderer/src/spawnGate.test.ts
git commit -m "feat(spawn): restoredSpawnIds — restore re-applies the first-load boot/resume rules"
```

---

### Task 11: App wiring — archive dialog, restore, documents

**Files:**
- Modify: `src/renderer/src/App.tsx`

App glue around already-tested pieces (store ops, IPC, Sidebar, ArchiveDialog, `restoredSpawnIds`); no new unit tests of its own — verification is typecheck + suite (this task turns typecheck green again) + the manual smoke test in Task 13.

- [ ] **Step 1: Wire the archive into App**

In `src/renderer/src/App.tsx`:

1. Extend imports:

```ts
import { shouldSpawn, restoredSpawnIds } from './spawnGate'
import { ArchiveDialog } from './components/ArchiveDialog'
```

and add `archiveFeature, restoreFeature, deleteArchivedFeature` to the `./store` import list.

2. Add state + handlers (near `groupDialogOpen`):

```ts
  const [archiveGroupId, setArchiveGroupId] = useState<string | null>(null)
  const archiveGroup = archiveGroupId
    ? state.workspace.groups.find((g) => g.id === archiveGroupId) ?? null
    : null

  // Restore = the app-restart rules for this feature's terminals: cold until
  // opened, agents resume. Refs are mutated BEFORE apply() so the remount sees
  // them; a pre-archive "started" flag must not auto-launch anything either.
  const restoreArchivedFeature = (featureId: string) => {
    const f = archiveGroup?.archivedFeatures?.find((x) => x.id === featureId)
    if (!f) return
    const { bootIds, resumeIds } = restoredSpawnIds(f)
    for (const id of bootIds) bootIdsRef.current.add(id)
    for (const id of resumeIds) resumeIdsRef.current.add(id)
    setStartedIds((prev) => {
      const next = new Set(prev)
      for (const id of bootIds) next.delete(id)
      return next
    })
    apply((s) => restoreFeature(s, featureId))
  }
```

3. Pass the new Sidebar props (with the others):

```tsx
        onArchiveFeature={(fid) => apply((s) => archiveFeature(s, fid))}
        onOpenArchive={(gid) => setArchiveGroupId(gid)}
```

4. Render the dialog next to the other dialogs (before `{confirm && ...}` so ConfirmDialog, `z-[60]`, stacks above it):

```tsx
      {archiveGroup && (
        <ArchiveDialog
          group={archiveGroup}
          onArchive={(fid) => apply((s) => archiveFeature(s, fid))}
          onRestore={restoreArchivedFeature}
          onDeleteArchived={(fid) => {
            const f = archiveGroup.archivedFeatures?.find((x) => x.id === fid)
            askDelete(`Permanently delete archived feature "${f?.name ?? ''}"? Its documents list goes with it.`, () =>
              apply((s) => deleteArchivedFeature(s, fid)))
          }}
          onClose={() => setArchiveGroupId(null)}
        />
      )}
```

(`archiveGroup` is re-derived from state each render, so the dialog's lists update live after every archive/restore — it stays open by design.)

- [ ] **Step 2: Wire the documents into App**

1. Extend the `./store` import with `addDocument, renameDocument, removeDocument`.

2. Add state + the add-document flow (near `renameTerminalId`):

```ts
  // Id of a just-added document whose rename input the sidebar should auto-open.
  const [renameDocId, setRenameDocId] = useState<string | null>(null)
  const addDocumentTo = async (featureId: string) => {
    const group = state.workspace.groups.find((g) => g.features.some((f) => f.id === featureId))
    const feature = group?.features.find((f) => f.id === featureId)
    const path = await window.brain.pickFile(group?.cwd ? { defaultPath: group.cwd } : undefined)
    if (!path) return
    if (feature?.documents?.some((d) => d.path === path)) return // already referenced: no-op
    const id = createId()
    apply((s) => addDocument(s, featureId, { id, name: path.split('/').pop() || path, path }))
    setRenameDocId(id)
  }
```

3. Add the existence check (near the other effects). Keyed on the joined path list so a rename/reorder doesn't re-stat the disk; re-checked on window focus:

```ts
  // Which referenced document files still exist — drives the broken-doc rows.
  const [docExists, setDocExists] = useState<Record<string, boolean>>({})
  const docPathsKey = state.workspace.groups
    .flatMap((g) => g.features).flatMap((f) => f.documents ?? []).map((d) => d.path)
    .sort().join('\n')
  useEffect(() => {
    const paths = docPathsKey ? Array.from(new Set(docPathsKey.split('\n'))) : []
    let stale = false
    const check = () => {
      if (paths.length === 0) { setDocExists({}); return }
      void window.brain.pathsExist(paths).then((flags) => {
        if (stale) return
        const next: Record<string, boolean> = {}
        paths.forEach((p, i) => { next[p] = flags[i] })
        setDocExists(next)
      })
    }
    check()
    window.addEventListener('focus', check)
    return () => { stale = true; window.removeEventListener('focus', check) }
  }, [docPathsKey])
```

4. Pass the remaining Sidebar props:

```tsx
        onAddDocument={(fid) => void addDocumentTo(fid)}
        onOpenDocument={(p) => window.brain.openPath(p)}
        onRenameDocument={(fid, did, name) => apply((s) => renameDocument(s, fid, did, name))}
        onRemoveDocument={(fid, did) => apply((s) => removeDocument(s, fid, did))}
        docExists={docExists}
        pendingRenameDocId={renameDocId}
        onPendingRenameDocConsumed={() => setRenameDocId(null)}
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: typecheck is GREEN again (every required Sidebar prop is now passed); all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(app): wire archive dialog, restart-equivalent restore, and feature documents"
```

---

### Task 12: Export includes archived features' sessions

**Files:**
- Modify: `src/main/exportImport.ts`
- Test: `src/main/exportImport.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/exportImport.test.ts`, append to the `describe('collectAgentSessions')` block:

```ts
  it('group scope also collects sessions from archived features', () => {
    const withArchive: Group = {
      ...group,
      archivedFeatures: [
        { id: 'fa', name: 'Old Flow', collapsed: false, terminals: [
          { id: 'cccc3333-0000-0000-0000-000000000000', name: 'claude', cwd: '/home/me/proj', kind: 'claude', sessionId: 'cs-old' }
        ] }
      ]
    }
    const refs = collectAgentSessions({ scope: 'group', group: withArchive })
    expect(refs.map((r) => r.sessionId)).toEqual(['cs-1', 'cx-1', 'cs-old'])
    expect(refs[2].featureName).toBe('Old Flow')
  })
```

Also add a round-trip test (new `describe` at the bottom; extend the `fs` import line with `mkdtempSync` — add `import { mkdtempSync } from 'fs'` if the file has no fs import yet):

```ts
describe('manifest round-trips archive + documents', () => {
  it('archivedFeatures and documents survive export → import extraction', async () => {
    const withExtras: Group = {
      ...group,
      features: [{ ...group.features[0], documents: [{ id: 'd1', name: 'spec', path: '/docs/spec.md' }] }],
      archivedFeatures: [{ id: 'fa', name: 'Old Flow', collapsed: false, terminals: [] }]
    }
    const out = tmpZip()
    await runExport({
      input: { scope: 'group', group: withExtras },
      outPath: out,
      summarize: async () => ({ ok: true, markdown: '# s' })
    })
    const res = await extractImportArchive(out, mkdtempSync(join(tmpdir(), 'brain-import-')))
    if ('error' in res) throw new Error(res.error)
    const g = (res.manifest as { group: Group }).group
    expect(g.archivedFeatures![0].name).toBe('Old Flow')
    expect(g.features[0].documents![0]).toMatchObject({ name: 'spec', path: '/docs/spec.md' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/exportImport.test.ts`
Expected: the `collectAgentSessions` test FAILS (`cs-old` missing). The round-trip test already PASSES (the manifest carries the `Group` object verbatim) — it pins that behavior against regressions.

- [ ] **Step 3: Implement**

In `src/main/exportImport.ts`, `collectAgentSessions`, replace the `features` line:

```ts
  // Group scope walks the archive too: an archived feature restored after import
  // (where the original sessionId is useless) must wake with a summary like any
  // other agent terminal.
  const features: Feature[] = input.scope === 'group'
    ? [...input.group.features, ...(input.group.archivedFeatures ?? [])]
    : [input.feature]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/exportImport.test.ts`
Expected: PASS — including the existing manifest round-trip tests (`archivedFeatures`/`documents` ride inside the `Group` object untouched).

- [ ] **Step 5: Commit**

```bash
git add src/main/exportImport.ts src/main/exportImport.test.ts
git commit -m "fix(export): collect agent sessions from archived features too"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`, then:

1. Right-click a feature → menu shows Rename / New Claude / New Codex / New Terminal / Add document… / Archive.
2. Archive a feature with a running shell → it disappears from the sidebar; `Archive (1)` row appears at the group's bottom; the shell's process is gone (`ps` shows no orphan).
3. Click the archive row → dialog lists Active/Archived; Restore the feature → it returns at the END of the list; its terminals are cold; opening the agent terminal resumes the session; the dialog stayed open.
4. Trash an archived feature → ConfirmDialog appears above the archive dialog; confirm deletes it.
5. Add document… → picker opens at the project cwd; picking a file adds a row named after the file with the rename input open; click opens it in the default app.
6. Delete the file on disk, refocus the window → the row dims with line-through; click does nothing.
7. Restart the app → archive, documents, and broken state survive.

- [ ] **Step 3: Wrap up the branch**

Use the superpowers:finishing-a-development-branch skill (per the user's workflow: `--no-ff` merge into master, confirm before pushing). Note: if `feature/export-import` has not merged yet, this branch must land after it.

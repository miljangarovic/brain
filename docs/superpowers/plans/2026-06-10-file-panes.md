# File Panes (In-App File Viewing & Editing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Files open as first-class panes inside the app — editable (CodeMirror, auto-save), markdown rendered⇄raw, images shown, binaries fall back — appearing in the tab bar, grid, and sidebar, persisted in the workspace.

**Architecture:** A parallel `Feature.files: FilePane[]` array (never mixed into `terminals`) keeps every PTY subsystem untouched; file panes render AFTER terminals in tabs/grid/sidebar. A new main-process `file:load`/`file:save` IPC pair does kind detection (text/image/binary/too-large/missing) with size limits; panes watch their file via the existing fs-watch channels. Auto-save is debounced and ALWAYS flushed on unmount/close/beforeunload.

**Tech Stack:** Electron + React 18 + TypeScript, CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/language-data`), `react-markdown` + `remark-gfm`, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-10-file-panes-design.md`

**Branch:** `feature/file-panes` off `develop`:

```bash
git checkout develop && git checkout -b feature/file-panes
```

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/shared/types.ts` | modify | `FilePane`, `Feature.files?` |
| `src/shared/files.ts` | create | `FileLoadResult` union (shared main↔renderer) |
| `src/shared/ipc.ts` | modify | `fileLoad`, `fileSave`, `shellOpenExternal` channels |
| `src/shared/api.ts` | modify | `loadFile`, `saveFile`, `openExternal` on `BrainApi` |
| `src/main/fileLoad.ts` | create | kind detection + load/save (pure, tmp-file tested) |
| `src/main/ipc.ts` | modify | register the three new handlers |
| `src/preload/index.ts` | modify | wire the three new API methods |
| `src/renderer/src/migrate.ts` | modify | sanitize `Feature.files` |
| `src/renderer/src/store.ts` | modify | file-pane ops + uniform selection fallback |
| `src/renderer/src/components/icons.tsx` | modify | `FileCodeIcon` (open-file rows/tabs/headers) |
| `src/renderer/src/components/CodeEditor.tsx` | create | CodeMirror wrapper (lazy language, dark theme) |
| `src/renderer/src/components/MarkdownView.tsx` | create | rendered markdown, external links |
| `src/renderer/src/components/FilePaneView.tsx` | create | one open file: load/watch/auto-save/flush + per-kind render |
| `src/renderer/src/components/TabBar.tsx` | modify | union view-model (terminal + file tabs) |
| `src/renderer/src/components/Sidebar.tsx` | modify | file rows (activate/rename/close/reorder), doc-row context menu |
| `src/renderer/src/components/TerminalView.tsx` | modify | Ctrl+click link opens in-app via callback |
| `src/renderer/src/components/TerminalPane.tsx` | modify | thread the link callback |
| `src/renderer/src/App.tsx` | modify | wiring: union tabs/grid, shortcuts, entry points |
| `src/renderer/src/importRemap.ts` | modify | carry `files` through import |

Run one test file: `npx vitest run <path>`; whole suite: `npm test`.

> **Typecheck note:** Tasks 8 (TabBar) and 9 (Sidebar) change component props ahead of the
> App wiring in Task 10 — `npm run typecheck` is RED in between, with errors confined to
> App.tsx call sites. Expected; do not make props optional. Vitest stays green throughout.

---

### Task 1: Types + migration

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/migrate.ts`
- Test: `src/renderer/src/migrate.test.ts`

- [ ] **Step 1: Add the type**

In `src/shared/types.ts`, below `FeatureDoc`:

```ts
// An OPEN file shown as a pane of the feature (tab bar + grid + sidebar) — a
// reference by absolute path, loaded on mount. Unlike FeatureDoc (a passive
// bookmark), a FilePane is a live view/editor and participates in selection.
export interface FilePane {
  id: string
  path: string                  // absolute path on disk
  name: string                  // display name; defaults to the file's basename
  mdView?: 'rendered' | 'raw'   // markdown view state; undefined === 'rendered'
}
```

Add to `Feature` (after `documents?`):

```ts
  files?: FilePane[]           // open file panes; undefined === []
```

- [ ] **Step 2: Write the failing migrate tests**

Append to `src/renderer/src/migrate.test.ts` inside the `describe('archive + documents migration')` block (or a sibling describe):

```ts
  it('sanitizes feature files: fills ids/names, drops entries without a path, keeps valid mdView', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [
      { id: 'f', name: 'auth', collapsed: false, terminals: [], files: [
        { name: 'spec', path: '/docs/spec.md', mdView: 'raw' },
        { path: '/docs/plan.md', mdView: 'sideways' },
        { name: 'no-path' },
        'garbage'
      ] }
    ] }] })
    const files = ws.groups[0].features[0].files!
    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({ name: 'spec', path: '/docs/spec.md', mdView: 'raw' })
    expect(files[0].id).toBeTruthy()
    expect(files[1].name).toBe('plan.md')      // basename fallback
    expect(files[1].mdView).toBeUndefined()    // invalid mdView dropped
  })

  it('omits files when the sanitized list is empty', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'p', cwd: '', features: [
      { id: 'f', name: 'auth', collapsed: false, terminals: [], files: ['junk'] }
    ] }] })
    expect(ws.groups[0].features[0].files).toBeUndefined()
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/migrate.test.ts`
Expected: the two new tests FAIL (raw `files` survives the spread unsanitized).

- [ ] **Step 4: Implement**

In `src/renderer/src/migrate.ts`: extend the types import with `FilePane`. Below `sanitizeDoc` add:

```ts
// An open-file pane needs a path; entries without one are dropped. Missing
// ids/names are filled; mdView is kept only when it is a known value.
function sanitizeFilePane(pv: unknown): FilePane | null {
  if (!isObj(pv)) return null
  const p = pv as unknown as FilePane
  if (typeof p.path !== 'string' || !p.path) return null
  return {
    id: str(p.id, createId()),
    name: str(p.name, p.path.split('/').pop() || 'file'),
    path: p.path,
    ...(p.mdView === 'rendered' || p.mdView === 'raw' ? { mdView: p.mdView } : {})
  }
}
```

In `sanitizeFeature`, destructure `files` out of the spread alongside `documents` and re-attach sanitized:

```ts
  const { documents: _rawDocs, files: _rawFiles, ...rest } = f
  const docs = (Array.isArray(f.documents) ? f.documents : []).map(sanitizeDoc).filter((d): d is FeatureDoc => d !== null)
  const files = (Array.isArray(f.files) ? f.files : []).map(sanitizeFilePane).filter((p): p is FilePane => p !== null)
  return {
    ...rest,
    id: str(f.id, createId()),
    name: str(f.name, 'general'),
    collapsed: !!f.collapsed,
    terminals: (Array.isArray(f.terminals) ? f.terminals : []).map(sanitizeTerminal).filter((t): t is Terminal => t !== null),
    ...(docs.length > 0 ? { documents: docs } : {}),
    ...(files.length > 0 ? { files } : {})
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/migrate.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/src/migrate.ts src/renderer/src/migrate.test.ts
git commit -m "feat(types): FilePane on Feature.files, with load-time sanitizing"
```

---

### Task 2: Main — `fileLoad` module (kind detection + save)

**Files:**
- Create: `src/shared/files.ts`
- Create: `src/main/fileLoad.ts`
- Test: `src/main/fileLoad.test.ts`

- [ ] **Step 1: Shared result type**

Create `src/shared/files.ts`:

```ts
// Result of file:load — what the renderer can do with a path. Text within the
// limit is editable; images render read-only; everything else gets a fallback.
export type FileLoadResult =
  | { kind: 'text'; content: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'binary' }
  | { kind: 'too-large'; size: number }
  | { kind: 'missing' }
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/fileLoad.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadFile, saveFile, TEXT_LIMIT } from './fileLoad'

const dir = () => mkdtempSync(join(tmpdir(), 'brain-fileload-'))

describe('loadFile', () => {
  it('reads UTF-8 text', async () => {
    const p = join(dir(), 'a.ts')
    writeFileSync(p, 'const x = 1\n')
    await expect(loadFile(p)).resolves.toEqual({ kind: 'text', content: 'const x = 1\n' })
  })

  it('detects images by extension and returns a data URL', async () => {
    const p = join(dir(), 'pix.png')
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const res = await loadFile(p)
    expect(res.kind).toBe('image')
    if (res.kind === 'image') expect(res.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('detects binary via null bytes', async () => {
    const p = join(dir(), 'blob.bin')
    writeFileSync(p, Buffer.from([0x68, 0x00, 0x69]))
    await expect(loadFile(p)).resolves.toEqual({ kind: 'binary' })
  })

  it('rejects oversized text as too-large with the size', async () => {
    const p = join(dir(), 'big.txt')
    writeFileSync(p, 'x'.repeat(TEXT_LIMIT + 1))
    await expect(loadFile(p)).resolves.toEqual({ kind: 'too-large', size: TEXT_LIMIT + 1 })
  })

  it('missing/unreadable files report missing', async () => {
    await expect(loadFile(join(dir(), 'nope.txt'))).resolves.toEqual({ kind: 'missing' })
  })
})

describe('saveFile', () => {
  it('writes content and round-trips through loadFile', async () => {
    const p = join(dir(), 'out.md')
    await expect(saveFile(p, '# hello')).resolves.toEqual({ ok: true })
    await expect(loadFile(p)).resolves.toEqual({ kind: 'text', content: '# hello' })
  })

  it('reports failure as ok:false with an error string', async () => {
    const res = await saveFile(join(dir(), 'no-such-dir', 'x.txt'), 'x')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/main/fileLoad.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement**

Create `src/main/fileLoad.ts`:

```ts
import { promises as fsp } from 'fs'
import { extname } from 'path'
import type { FileLoadResult } from '@shared/files'

export const TEXT_LIMIT = 2 * 1024 * 1024    // editor cap
export const IMAGE_LIMIT = 20 * 1024 * 1024  // data-URL cap

// Image detection is by extension — content sniffing buys little here and the
// <img> tag fails gracefully on a lying extension.
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

// What can the renderer do with this path? Text within the limit is editable;
// images become data URLs (a file:// src does not load from the dev-server
// origin); null bytes in the head or invalid UTF-8 read as binary.
export async function loadFile(path: string): Promise<FileLoadResult> {
  let buf: Buffer
  try { buf = await fsp.readFile(path) } catch { return { kind: 'missing' } }
  const mime = IMAGE_MIME[extname(path).toLowerCase()]
  if (mime) {
    if (buf.length > IMAGE_LIMIT) return { kind: 'too-large', size: buf.length }
    return { kind: 'image', dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  }
  if (buf.subarray(0, 8192).includes(0)) return { kind: 'binary' }
  if (buf.length > TEXT_LIMIT) return { kind: 'too-large', size: buf.length }
  const content = buf.toString('utf8')
  // The replacement char only appears when decoding hit invalid UTF-8 (or the
  // file legitimately contains U+FFFD — rare enough to accept as "binary").
  if (content.includes('�')) return { kind: 'binary' }
  return { kind: 'text', content }
}

export async function saveFile(path: string, content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fsp.writeFile(path, content, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/fileLoad.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/files.ts src/main/fileLoad.ts src/main/fileLoad.test.ts
git commit -m "feat(files): loadFile/saveFile with kind detection and size limits"
```

---

### Task 3: IPC + API + preload wiring

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/main/ipc.ts`, `src/preload/index.ts`

No new unit tests (thin wiring over the Task 2 module — same approach as `pathsExist`); acceptance is typecheck + suite.

- [ ] **Step 1: Channels**

In `src/shared/ipc.ts`, append to the `IPC` object:

```ts
  fileLoad: 'file:load',
  fileSave: 'file:save',
  shellOpenExternal: 'shell:openExternal'
```

- [ ] **Step 2: API surface**

In `src/shared/api.ts`: add `import type { FileLoadResult } from './files'` and extend `BrainApi`:

```ts
  // In-app file panes. loadFile classifies the path (text/image/binary/…);
  // saveFile writes editor content back. readTextFile (fs:read) stays separate —
  // the review loop depends on it; do not merge the two surfaces.
  loadFile(path: string): Promise<FileLoadResult>
  saveFile(path: string, content: string): Promise<{ ok: true } | { ok: false; error: string }>
  // http(s) links from rendered markdown — openPath only handles filesystem paths.
  openExternal(url: string): void
```

- [ ] **Step 3: Main handlers**

In `src/main/ipc.ts`: add `import { loadFile, saveFile } from './fileLoad'`. Register next to the `IPC.fsRead` handler:

```ts
  // In-app file panes: classify + load a file, and write editor content back.
  ipcMain.handle(IPC.fileLoad, (_e, p: { path: string }) => loadFile(p.path))
  ipcMain.handle(IPC.fileSave, (_e, p: { path: string; content: string }) => saveFile(p.path, p.content))
  // Rendered-markdown links are http(s) URLs — shell.openPath can't open those.
  ipcMain.on(IPC.shellOpenExternal, (_e, p: { url: string }) => {
    if (/^https?:\/\//i.test(p?.url ?? '')) void shell.openExternal(p.url)
  })
```

- [ ] **Step 4: Preload**

In `src/preload/index.ts`, add to the `api` object:

```ts
  loadFile: (path) => ipcRenderer.invoke(IPC.fileLoad, { path }) as Promise<import('../shared/files').FileLoadResult>,
  saveFile: (path, content) => ipcRenderer.invoke(IPC.fileSave, { path, content }) as Promise<{ ok: true } | { ok: false; error: string }>,
  openExternal: (url) => ipcRenderer.send(IPC.shellOpenExternal, { url }),
```

(If the file imports types at the top, prefer a top-level `import type { FileLoadResult } from '../shared/files'` over the inline import.)

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test` → clean/green.

```bash
git add src/shared/ipc.ts src/shared/api.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(ipc): file:load / file:save / shell:openExternal"
```

---

### Task 4: Store — file-pane operations

**Files:**
- Modify: `src/renderer/src/store.ts`
- Test: `src/renderer/src/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/store.test.ts` (extend the `./store` import with `openFile, closeFile, moveFile, renameFilePane, setFilePaneMdView, findFilePane, setActiveTerminal`):

```ts
describe('file panes', () => {
  const setup = () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'term' })
    return { s, fid, tid: s.workspace.groups[0].features[0].terminals[0].id }
  }
  const filesOf = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0].features[0].files

  it('openFile appends a pane (name defaults to basename) and activates it', () => {
    const { s, fid } = setup()
    const out = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    expect(filesOf(out)).toEqual([{ id: 'p1', path: '/p/readme.md', name: 'readme.md' }])
    expect(out.activeTerminalId).toBe('p1')
    expect(out.activeFeatureId).toBe(fid)
  })

  it('openFile with an already-open path just activates the existing pane', () => {
    let { s, fid, tid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    s = setActiveTerminal(s, tid)
    const out = openFile(s, fid, { path: '/p/readme.md' })
    expect(filesOf(out)).toHaveLength(1)
    expect(out.activeTerminalId).toBe('p1')
  })

  it('setActiveTerminal accepts a file pane id and selects its feature', () => {
    let { s, fid, tid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    s = setActiveTerminal(s, tid)
    const out = setActiveTerminal(s, 'p1')
    expect(out.activeTerminalId).toBe('p1')
    expect(out.activeFeatureId).toBe(fid)
  })

  it('closeFile removes the pane; selection falls to the first visible terminal', () => {
    let { s, fid, tid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    const out = closeFile(s, 'p1')
    expect(filesOf(out)).toHaveLength(0)
    expect(out.activeTerminalId).toBe(tid)
  })

  it('closeFile falls back to another file pane when no terminal is visible', () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    s = openFile(s, fid, { id: 'p2', path: '/p/b.md' })
    const out = closeFile(s, 'p2')
    expect(out.activeTerminalId).toBe('p1')
    expect(closeFile(out, 'p1').activeTerminalId).toBeNull()
  })

  it('closeFile of a non-active pane leaves selection untouched; unknown id is a no-op', () => {
    let { s, fid, tid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    s = setActiveTerminal(s, tid)
    expect(closeFile(s, 'p1').activeTerminalId).toBe(tid)
    expect(closeFile(s, 'nope')).toBe(s)
  })

  it('moveFile reorders within the feature; renameFilePane and setFilePaneMdView patch the pane', () => {
    let { s, fid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    s = openFile(s, fid, { id: 'p2', path: '/p/b.md' })
    s = moveFile(s, 'p2', 0)
    expect(filesOf(s)!.map((p) => p.id)).toEqual(['p2', 'p1'])
    s = renameFilePane(s, 'p1', 'Notes')
    s = setFilePaneMdView(s, 'p1', 'raw')
    const p1 = filesOf(s)!.find((p) => p.id === 'p1')!
    expect(p1.name).toBe('Notes')
    expect(p1.mdView).toBe('raw')
  })

  it('findFilePane locates a pane and its feature; archived features carry files along', () => {
    let { s, fid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    expect(findFilePane(s, 'p1')?.feature.id).toBe(fid)
    const archived = archiveFeature(s, fid)
    expect(findFilePane(archived, 'p1')).toBeNull() // active features only
    expect(archived.workspace.groups[0].archivedFeatures![0].files).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/store.test.ts` → FAIL (`openFile` not exported).

- [ ] **Step 3: Implement**

In `src/renderer/src/store.ts`: extend the types import with `FilePane`. Note in `AppState`:
update the comment on `activeTerminalId` to:

```ts
  activeTerminalId: string | null // the ACTIVE PANE id — a terminal OR an open file pane
```

Add a helper next to `featureOfTerminal`:

```ts
const featureOfFilePane = (ws: Workspace, paneId: string): { group: Group; feature: Feature } | undefined => {
  for (const g of ws.groups) for (const f of g.features) if ((f.files ?? []).some((p) => p.id === paneId)) return { group: g, feature: f }
  return undefined
}
```

In `setActiveTerminal`, extend the lookup so file pane ids select their feature too:

```ts
export function setActiveTerminal(state: AppState, terminalId: string): AppState {
  const loc = featureOfTerminal(state.workspace, terminalId) ?? featureOfFilePane(state.workspace, terminalId)
  return {
    ...state,
    activeGroupId: loc?.group.id ?? state.activeGroupId,
    activeFeatureId: loc?.feature.id ?? state.activeFeatureId,
    activeTerminalId: terminalId
  }
}
```

Add a new section after the documents section:

```ts
// ---- file panes ------------------------------------------------------------
// Open files shown as panes of a feature, parallel to terminals — no PTY, no
// spawn gating, never in `hidden`. Operations target ACTIVE features only.
export function openFile(state: AppState, featureId: string, input: { path: string; name?: string; id?: string }): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId)
  if (!group || !feature) return state
  const existing = (feature.files ?? []).find((p) => p.path === input.path)
  if (existing) return setActiveTerminal(state, existing.id)
  const pane: FilePane = {
    id: input.id ?? createId(),
    path: input.path,
    name: input.name ?? (input.path.split('/').pop() || input.path)
  }
  const next = {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, files: [...(f.files ?? []), pane] }))
  }
  return setActiveTerminal(next, pane.id)
}

export function closeFile(state: AppState, paneId: string): AppState {
  const loc = featureOfFilePane(state.workspace, paneId)
  if (!loc) return state
  const workspace = mapFeature(state.workspace, loc.feature.id, (f) => ({
    ...f, files: (f.files ?? []).filter((p) => p.id !== paneId)
  }))
  let { activeTerminalId } = state
  if (activeTerminalId === paneId) {
    const f2 = workspace.groups.flatMap((g) => g.features).find((f) => f.id === loc.feature.id) ?? null
    activeTerminalId = firstVisiblePane(f2, state.hidden)?.id ?? null
  }
  return { ...state, workspace, activeTerminalId }
}

// Reorder a file pane within its feature. Mirrors moveTerminal.
export function moveFile(state: AppState, paneId: string, toIndex: number): AppState {
  const loc = featureOfFilePane(state.workspace, paneId)
  if (!loc) return state
  const files = loc.feature.files ?? []
  const moved = files.find((p) => p.id === paneId)!
  const rest = files.filter((p) => p.id !== paneId)
  const dest = Math.max(0, Math.min(toIndex, rest.length))
  return {
    ...state,
    workspace: mapFeature(state.workspace, loc.feature.id, (f) => ({ ...f, files: [...rest.slice(0, dest), moved, ...rest.slice(dest)] }))
  }
}

const patchFilePane = (state: AppState, paneId: string, patch: Partial<FilePane>): AppState => {
  const loc = featureOfFilePane(state.workspace, paneId)
  if (!loc) return state
  return {
    ...state,
    workspace: mapFeature(state.workspace, loc.feature.id, (f) => ({
      ...f, files: (f.files ?? []).map((p) => (p.id === paneId ? { ...p, ...patch } : p))
    }))
  }
}

export function renameFilePane(state: AppState, paneId: string, name: string): AppState {
  return patchFilePane(state, paneId, { name })
}

export function setFilePaneMdView(state: AppState, paneId: string, mdView: 'rendered' | 'raw'): AppState {
  return patchFilePane(state, paneId, { mdView })
}

export const findFilePane = (s: AppState, paneId: string): { feature: Feature; pane: FilePane } | null => {
  const loc = featureOfFilePane(s.workspace, paneId)
  if (!loc) return null
  return { feature: loc.feature, pane: (loc.feature.files ?? []).find((p) => p.id === paneId)! }
}
```

`firstVisiblePane` does not exist yet — Task 5 introduces it. For THIS task add it right
below `firstVisibleTerminal` (Task 5 then retrofits the other callers):

```ts
// The uniform selection fallback: first visible terminal, else first file pane.
const firstVisiblePane = (f: Feature | null, hidden: string[]): { id: string } | null =>
  firstVisibleTerminal(f, hidden) ?? f?.files?.[0] ?? null
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/store.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(store): file pane open/close/move/rename/mdView + active-pane selection"
```

---

### Task 5: Store — uniform selection fallback + hidden guard

**Files:**
- Modify: `src/renderer/src/store.ts`
- Test: `src/renderer/src/store.test.ts`

The spec's rule — "first visible terminal, else first file pane, else null" — applied to
every selection fallback; and a file pane id must never enter `state.hidden`.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/store.test.ts` (extend the import with `hideTerminal, removeTerminal, toggleFeatureViewMode` if missing):

```ts
describe('file panes — uniform selection fallback', () => {
  const setupWithFile = () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'term' })
    const tid = s.workspace.groups[0].features[0].terminals[0].id
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    s = setActiveTerminal(s, tid)
    return { s, fid, tid }
  }

  it('hiding the last visible terminal selects the first file pane', () => {
    const { s, tid } = setupWithFile()
    const out = hideTerminal(s, tid)
    expect(out.activeTerminalId).toBe('p1')
  })

  it('hideTerminal is a no-op for file pane ids — they never enter hidden', () => {
    const { s } = setupWithFile()
    const active = setActiveTerminal(s, 'p1')
    const out = hideTerminal(active, 'p1')
    expect(out.hidden).toEqual([])
    expect(out.activeTerminalId).toBe('p1')
  })

  it('removing the last terminal selects the first file pane', () => {
    const { s, tid } = setupWithFile()
    const out = removeTerminal(s, tid)
    expect(out.activeTerminalId).toBe('p1')
  })

  it('grid→tabs collapse on a terminal-less feature focuses the first file pane', () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    s = toggleFeatureViewMode(s, fid) // tabs → grid
    const out = toggleFeatureViewMode(s, fid) // grid → tabs: refocus rule
    expect(out.activeTerminalId).toBe('p1')
  })

  it('selectFeature (via deleteFeature of the active feature) lands on a file-pane-only sibling', () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const gid = s.workspace.groups[0].id
    const generalId = s.workspace.groups[0].features[0].id
    s = openFile(s, generalId, { id: 'p1', path: '/p/a.md' })
    s = addFeature(s, gid, 'extra') // active now: 'extra'
    s = deleteFeature(s, s.workspace.groups[0].features[1].id)
    expect(s.activeFeatureId).toBe(generalId)
    expect(s.activeTerminalId).toBe('p1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: all five FAIL (fallbacks return null today; hideTerminal pollutes `hidden`).

- [ ] **Step 3: Implement**

In `src/renderer/src/store.ts`:

1. `selectFeature` uses the uniform rule:

```ts
const selectFeature = (g: Group | null, hidden: string[]): { featureId: string | null; terminalId: string | null } => {
  const f = g?.features[0] ?? null
  return { featureId: f?.id ?? null, terminalId: firstVisiblePane(f, hidden)?.id ?? null }
}
```

2. `hideTerminal` — guard at the top (file ids must never enter `hidden`), and the sibling
fallback becomes the uniform rule:

```ts
export function hideTerminal(state: AppState, terminalId: string): AppState {
  const loc = featureOfTerminal(state.workspace, terminalId)
  if (!loc) return state // not a terminal (e.g. a file pane id) — hide is a terminal concept
  if (state.hidden.includes(terminalId)) return state
  const hidden = [...state.hidden, terminalId]
  let activeTerminalId = state.activeTerminalId
  if (activeTerminalId === terminalId) {
    const sib = loc.feature.terminals.find((t) => t.id !== terminalId && !hidden.includes(t.id))
    activeTerminalId = sib?.id ?? loc.feature.files?.[0]?.id ?? null
  }
  return { ...state, hidden, activeTerminalId }
}
```

3. `removeTerminal` — in its selection fixup, after the existing candidate logic fails,
fall back to the feature's first file pane. Locate the block that computes
`activeTerminalId` from `cand`/`pick` and change the final assignment to:

```ts
        activeTerminalId = pick?.id ?? f.files?.[0]?.id ?? null
```

(`f` is the feature being mapped in that closure — adapt to the local variable name.)

4. `toggleFeatureViewMode` — the grid→tabs branch currently picks
`feature.terminals.find(...) ?? feature.terminals[0] ?? null`; change the pick to:

```ts
    const first = feature.terminals.find((t) => !state.hidden.includes(t.id)) ?? feature.terminals[0] ?? feature.files?.[0] ?? null
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/store.test.ts` → PASS (new + ALL pre-existing). `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(store): uniform pane selection fallback; file ids never enter hidden"
```

---

### Task 6: Dependencies + CodeEditor + MarkdownView + FileCodeIcon

**Files:**
- Modify: `package.json` (via npm install)
- Create: `src/renderer/src/components/CodeEditor.tsx`
- Create: `src/renderer/src/components/MarkdownView.tsx`
- Test: `src/renderer/src/components/MarkdownView.test.tsx`
- Modify: `src/renderer/src/components/icons.tsx` + `icons.test.tsx`

- [ ] **Step 1: Install dependencies**

```bash
npm install @uiw/react-codemirror @codemirror/language-data react-markdown remark-gfm
```

- [ ] **Step 2: Failing tests (MarkdownView + icon)**

Create `src/renderer/src/components/MarkdownView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MarkdownView } from './MarkdownView'

beforeEach(() => {
  ;(window as unknown as { brain: { openExternal: ReturnType<typeof vi.fn> } }).brain = { openExternal: vi.fn() } as never
})

describe('MarkdownView', () => {
  it('renders gfm markdown (headings, lists, tables)', () => {
    render(<MarkdownView source={'# Title\n\n- item\n\n| a | b |\n| - | - |\n| 1 | 2 |'} />)
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText('item')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('intercepts link clicks and opens them externally', async () => {
    render(<MarkdownView source={'[site](https://example.com)'} />)
    await userEvent.click(screen.getByRole('link', { name: 'site' }))
    expect(window.brain.openExternal).toHaveBeenCalledWith('https://example.com/')
  })
})
```

Append to `icons.test.tsx` (extend the import with `FileCodeIcon`):

```tsx
it('FileCodeIcon renders with its test id', () => {
  render(<FileCodeIcon />)
  expect(screen.getByTestId('icon-file-code')).toBeInTheDocument()
})
```

- [ ] **Step 3: Verify failure**

Run: `npx vitest run src/renderer/src/components/MarkdownView.test.tsx src/renderer/src/components/icons.test.tsx` → FAIL.

- [ ] **Step 4: Implement**

`src/renderer/src/components/MarkdownView.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Rendered markdown for a file pane. Read-only; links open in the system
// browser (the renderer must never navigate). Styling is hand-rolled tailwind —
// no typography plugin dependency.
export function MarkdownView({ source }: { source: string }) {
  return (
    <div
      className="h-full overflow-y-auto bg-surface px-6 py-4"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (a && a.href) { e.preventDefault(); window.brain.openExternal(a.href) }
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h1 className="mt-2 mb-3 text-2xl font-semibold tracking-tight text-fg-bright" {...p} />,
          h2: (p) => <h2 className="mt-5 mb-2 text-xl font-semibold tracking-tight text-fg-bright" {...p} />,
          h3: (p) => <h3 className="mt-4 mb-1.5 text-lg font-semibold text-fg-bright" {...p} />,
          h4: (p) => <h4 className="mt-3 mb-1 text-base font-semibold text-fg-bright" {...p} />,
          p: (p) => <p className="my-2 text-sm leading-relaxed text-fg" {...p} />,
          a: (p) => <a className="text-accent underline decoration-accent/40 hover:decoration-accent cursor-pointer" {...p} />,
          ul: (p) => <ul className="my-2 list-disc pl-6 text-sm text-fg" {...p} />,
          ol: (p) => <ol className="my-2 list-decimal pl-6 text-sm text-fg" {...p} />,
          li: (p) => <li className="my-0.5 leading-relaxed" {...p} />,
          blockquote: (p) => <blockquote className="my-2 border-l-2 border-accent/50 pl-3 text-sm text-fg-muted" {...p} />,
          code: (p) => <code className="rounded bg-panel px-1 py-0.5 text-[0.85em] text-fg-bright" {...p} />,
          pre: (p) => <pre className="my-3 overflow-x-auto rounded-md border border-line bg-panel p-3 text-xs leading-relaxed" {...p} />,
          table: (p) => <table className="my-3 border-collapse text-sm" {...p} />,
          th: (p) => <th className="border border-line bg-panel px-2 py-1 text-left font-semibold text-fg-bright" {...p} />,
          td: (p) => <td className="border border-line px-2 py-1 text-fg" {...p} />,
          hr: () => <hr className="my-4 border-line" />
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
```

`src/renderer/src/components/CodeEditor.tsx`:

```tsx
import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { MONO_FONT } from '../theme'

// Minimal dark theme from the app palette (CSS variables defined in index.css).
const appTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--od-surface)', color: 'var(--od-fg)', height: '100%', fontSize: '13px' },
  '.cm-content': { fontFamily: MONO_FONT, caretColor: 'var(--od-accent)' },
  '.cm-gutters': { backgroundColor: 'var(--od-surface)', color: 'var(--od-fg-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--od-accent) 7%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--od-fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--od-accent) 25%, transparent)'
  },
  '.cm-cursor': { borderLeftColor: 'var(--od-accent)' }
}, { dark: true })

// CodeMirror 6 wrapper: language loads lazily by filename so no grammar ships
// in the main bundle until a file of that type is actually opened.
export function CodeEditor({ value, path, onChange }: {
  value: string
  path: string
  onChange: (text: string) => void
}) {
  const [lang, setLang] = useState<Extension | null>(null)
  useEffect(() => {
    let stale = false
    const name = path.split('/').pop() ?? ''
    const desc = LanguageDescription.matchFilename(languages, name)
    if (!desc) { setLang(null); return }
    void desc.load().then((support) => { if (!stale) setLang(support) })
    return () => { stale = true }
  }, [path])
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={appTheme}
      extensions={lang ? [lang, EditorView.lineWrapping] : [EditorView.lineWrapping]}
      height="100%"
      style={{ height: '100%' }}
    />
  )
}
```

(Check `src/renderer/src/index.css` for the actual CSS variable names — the app uses
`--od-*` vars per TerminalPane; adapt if any differ.)

CodeEditor gets no direct unit test — CodeMirror needs real layout APIs jsdom lacks;
`FilePaneView` tests (Task 7) mock it. This is the same boundary the codebase draws
around xterm (`TerminalView` has no direct DOM test of the terminal itself).

Append to `icons.tsx`:

```tsx
export function FileCodeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-file-code" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M10.5 11.5 8.5 13.5l2 2" />
      <path d="M13.5 11.5l2 2-2 2" />
    </svg>
  )
}
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/renderer/src/components/MarkdownView.test.tsx src/renderer/src/components/icons.test.tsx` → PASS. `npm test && npm run typecheck` → green/clean.

```bash
git add package.json package-lock.json src/renderer/src/components/CodeEditor.tsx src/renderer/src/components/MarkdownView.tsx src/renderer/src/components/icons.tsx src/renderer/src/components/icons.test.tsx src/renderer/src/components/MarkdownView.test.tsx
git commit -m "feat(files): CodeEditor (CodeMirror 6), MarkdownView (gfm), FileCodeIcon"
```

---

### Task 7: FilePaneView — load, watch, auto-save with flush

**Files:**
- Create: `src/renderer/src/components/FilePaneView.tsx`
- Test: `src/renderer/src/components/FilePaneView.test.tsx`

The heart of the feature. Auto-save is debounced 500 ms and FLUSHED on unmount and on
`beforeunload` — a pane never disappears with unsaved keystrokes. External changes:
self-echo ignored (disk == last write), clean editor reloads silently, dirty editor
skips the reload (last writer wins).

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/components/FilePaneView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilePaneView, SAVE_DEBOUNCE_MS } from './FilePaneView'
import type { FilePane } from '@shared/types'
import type { FileLoadResult } from '@shared/files'

// CodeMirror needs layout APIs jsdom lacks — substitute a plain textarea that
// forwards value/onChange; FilePaneView's logic is what we're testing.
vi.mock('./CodeEditor', () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange: (t: string) => void }) => (
    <textarea aria-label="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  )
}))

const pane: FilePane = { id: 'p1', path: '/p/readme.md', name: 'readme.md' }

type BrainMock = {
  loadFile: ReturnType<typeof vi.fn>
  saveFile: ReturnType<typeof vi.fn>
  watchFile: ReturnType<typeof vi.fn>
  unwatchFile: ReturnType<typeof vi.fn>
  onFsChanged: ReturnType<typeof vi.fn>
  openPath: ReturnType<typeof vi.fn>
}
let brain: BrainMock
let fsChangedCb: ((watchId: string) => void) | null

const setBrain = (load: FileLoadResult) => {
  fsChangedCb = null
  brain = {
    loadFile: vi.fn().mockResolvedValue(load),
    saveFile: vi.fn().mockResolvedValue({ ok: true }),
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
    onFsChanged: vi.fn((cb: (id: string) => void) => { fsChangedCb = cb; return () => { fsChangedCb = null } }),
    openPath: vi.fn()
  }
  ;(window as unknown as { brain: BrainMock }).brain = brain
}

function renderPane(over: Partial<Parameters<typeof FilePaneView>[0]> = {}) {
  const props = {
    pane, active: true, gridded: false, visibleInTabs: true,
    onActivate: () => {}, onClose: () => {}, onSetMdView: () => {}, onOpenExternally: () => {},
    ...over
  }
  return render(<FilePaneView {...props} />)
}

afterEach(() => vi.useRealTimers())

describe('FilePaneView', () => {
  it('loads text and shows the editor (md defaults to rendered view)', async () => {
    setBrain({ kind: 'text', content: '# hi' })
    renderPane()
    // .md + default mdView 'rendered' → MarkdownView, not the editor
    expect(await screen.findByRole('heading', { name: 'hi' })).toBeInTheDocument()
    expect(brain.watchFile).toHaveBeenCalledWith('p1', '/p/readme.md')
  })

  it('raw mdView shows the editor; the toggle calls onSetMdView', async () => {
    setBrain({ kind: 'text', content: '# hi' })
    const onSetMdView = vi.fn()
    renderPane({ pane: { ...pane, mdView: 'raw' }, onSetMdView })
    expect(await screen.findByLabelText('editor')).toHaveValue('# hi')
    await userEvent.click(screen.getByRole('button', { name: 'Rendered view' }))
    expect(onSetMdView).toHaveBeenCalledWith('rendered')
  })

  it('non-md text goes straight to the editor', async () => {
    setBrain({ kind: 'text', content: 'const x = 1' })
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    expect(await screen.findByLabelText('editor')).toHaveValue('const x = 1')
  })

  it('debounces auto-save and writes the latest content', async () => {
    setBrain({ kind: 'text', content: 'a' })
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    const editor = await screen.findByLabelText('editor')
    vi.useFakeTimers()
    act(() => {
      ;(editor as HTMLTextAreaElement).focus()
    })
    // fire two rapid changes through the textarea's onChange
    act(() => {
      const ev = (v: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        setter.call(editor, v)
        editor.dispatchEvent(new Event('input', { bubbles: true }))
      }
      ev('ab'); ev('abc')
    })
    expect(brain.saveFile).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10) })
    expect(brain.saveFile).toHaveBeenCalledTimes(1)
    expect(brain.saveFile).toHaveBeenCalledWith('/p/a.ts', 'abc')
  })

  it('FLUSHES the pending save on unmount', async () => {
    setBrain({ kind: 'text', content: 'a' })
    const r = renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    const editor = await screen.findByLabelText('editor')
    vi.useFakeTimers()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(editor, 'ab')
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    r.unmount() // inside the debounce window
    expect(brain.saveFile).toHaveBeenCalledWith('/p/a.ts', 'ab')
    expect(brain.unwatchFile).toHaveBeenCalledWith('p2')
  })

  it('external change with a clean editor reloads silently; self-echo is ignored', async () => {
    setBrain({ kind: 'text', content: 'v1' })
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    await screen.findByLabelText('editor')
    brain.loadFile.mockResolvedValue({ kind: 'text', content: 'v2' })
    await act(async () => { fsChangedCb?.('p2') })
    await waitFor(() => expect(screen.getByLabelText('editor')).toHaveValue('v2'))
    // self-echo: disk equals what we already have → no visible change, no error
    await act(async () => { fsChangedCb?.('p2') })
    expect(screen.getByLabelText('editor')).toHaveValue('v2')
  })

  it('image / binary / too-large / missing render their fallbacks', async () => {
    setBrain({ kind: 'image', dataUrl: 'data:image/png;base64,AAAA' })
    const r1 = renderPane({ pane: { id: 'p3', path: '/p/x.png', name: 'x.png' } })
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    r1.unmount()

    setBrain({ kind: 'binary' })
    const onOpenExternally = vi.fn()
    const r2 = renderPane({ pane: { id: 'p4', path: '/p/x.bin', name: 'x.bin' }, onOpenExternally })
    expect(await screen.findByText(/binary file/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open externally' }))
    expect(onOpenExternally).toHaveBeenCalled()
    r2.unmount()

    setBrain({ kind: 'too-large', size: 99 })
    const r3 = renderPane({ pane: { id: 'p5', path: '/p/big.txt', name: 'big.txt' } })
    expect(await screen.findByText(/too large/i)).toBeInTheDocument()
    r3.unmount()

    setBrain({ kind: 'missing' })
    renderPane({ pane: { id: 'p6', path: '/p/gone.txt', name: 'gone.txt' } })
    expect(await screen.findByText(/not found/i)).toBeInTheDocument()
  })

  it('a failed save shows the error strip; the next successful save clears it', async () => {
    setBrain({ kind: 'text', content: 'a' })
    brain.saveFile.mockResolvedValueOnce({ ok: false, error: 'EACCES' })
    renderPane({ pane: { id: 'p2', path: '/p/a.ts', name: 'a.ts' } })
    const editor = await screen.findByLabelText('editor')
    vi.useFakeTimers()
    const type = (v: string) => act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(editor, v)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    type('ab')
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10) })
    vi.useRealTimers()
    expect(await screen.findByText(/EACCES/)).toBeInTheDocument()
    vi.useFakeTimers()
    type('abc')
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 10) })
    vi.useRealTimers()
    await waitFor(() => expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument())
  })
})
```

(If a timing assertion proves brittle under jsdom, prefer `await waitFor(...)` over
longer sleeps — but keep the flush-on-unmount synchronous assertion: the flush must
happen during cleanup, not on a timer.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/FilePaneView.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/renderer/src/components/FilePaneView.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilePane } from '@shared/types'
import type { FileLoadResult } from '@shared/files'
import { CodeEditor } from './CodeEditor'
import { MarkdownView } from './MarkdownView'
import { FileCodeIcon } from './icons'
import { MONO_FONT } from '../theme'

export const SAVE_DEBOUNCE_MS = 500

const ACTIVE_PANE_SHADOW =
  '0 0 0 1px var(--od-accent), 0 0 0 4px color-mix(in srgb, var(--od-accent) 16%, transparent), 0 12px 30px -16px rgba(0,0,0,0.75)'

// One open file. Mirrors TerminalPane's two shapes (gridded card / tabs fill)
// but mounts only while visible — there is no live process to preserve.
// Auto-save is debounced and ALWAYS flushed on unmount/beforeunload: a pane
// never disappears with unsaved keystrokes.
export function FilePaneView({
  pane, active, gridded, gridRowSpan, gridColSpan, visibleInTabs, onActivate, onClose, onSetMdView, onOpenExternally
}: {
  pane: FilePane
  active: boolean
  gridded: boolean
  gridRowSpan?: number
  gridColSpan?: number
  visibleInTabs: boolean
  onActivate: () => void
  onClose: () => void
  onSetMdView: (view: 'rendered' | 'raw') => void
  onOpenExternally: () => void
}) {
  const [load, setLoad] = useState<FileLoadResult | { kind: 'loading' }>({ kind: 'loading' })
  const [doc, setDoc] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const savedRef = useRef('')   // last content we wrote or accepted from disk
  const dirtyRef = useRef(false)
  const docRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSave = useCallback((text: string) => {
    savedRef.current = text
    dirtyRef.current = false
    void window.brain.saveFile(pane.path, text).then((res) => {
      if (res.ok) setSaveError(null)
      else { setSaveError(res.error); dirtyRef.current = true }
    })
  }, [pane.path])

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (dirtyRef.current) doSave(docRef.current)
  }, [doSave])

  const onChange = (text: string) => {
    docRef.current = text
    setDoc(text)
    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { timerRef.current = null; doSave(docRef.current) }, SAVE_DEBOUNCE_MS)
  }

  const reload = useCallback(async () => {
    const res = await window.brain.loadFile(pane.path)
    if (res.kind === 'text') {
      if (res.content !== savedRef.current) {
        if (dirtyRef.current) return  // user mid-edit: the debounced save wins
        savedRef.current = res.content
        docRef.current = res.content
        setDoc(res.content)
      }
    }
    setLoad(res)
  }, [pane.path])

  useEffect(() => {
    void reload()
    window.brain.watchFile(pane.id, pane.path)
    const offChanged = window.brain.onFsChanged((watchId) => { if (watchId === pane.id) void reload() })
    window.addEventListener('beforeunload', flush)
    return () => {
      flush() // unmount inside the debounce window must still save
      window.removeEventListener('beforeunload', flush)
      offChanged()
      window.brain.unwatchFile(pane.id)
    }
  }, [pane.id, pane.path, reload, flush])

  const isMd = /\.(md|markdown)$/i.test(pane.path)
  const mdView = pane.mdView ?? 'rendered'
  const showRendered = isMd && mdView === 'rendered' && load.kind === 'text'

  const toggleBtn = (on: boolean) =>
    `px-2 py-0.5 text-[11px] rounded transition-colors ${on ? 'bg-accent text-surface' : 'text-fg-muted hover:text-fg hover:bg-hover'}`

  const body = () => {
    switch (load.kind) {
      case 'loading':
        return <div className="flex h-full items-center justify-center text-sm text-fg-muted">Loading…</div>
      case 'text':
        return showRendered ? <MarkdownView source={doc} /> : <CodeEditor value={doc} path={pane.path} onChange={onChange} />
      case 'image':
        return (
          <div className="flex h-full items-center justify-center overflow-auto bg-surface p-4">
            <img src={load.dataUrl} alt={pane.name} className="max-h-full max-w-full object-contain" />
          </div>
        )
      case 'binary':
      case 'too-large':
      case 'missing': {
        const msg = load.kind === 'binary'
          ? 'Binary file — cannot display it here.'
          : load.kind === 'too-large'
            ? `File too large to open in the editor (${Math.round(load.size / 1024 / 1024)} MB).`
            : 'File not found on disk.'
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-muted">
            <FileCodeIcon className="text-2xl opacity-60" />
            <span className="text-sm">{msg}</span>
            {load.kind !== 'missing' && (
              <button
                onClick={onOpenExternally}
                className="rounded-md px-3 py-1.5 text-sm text-fg ring-1 ring-line hover:bg-hover transition-colors"
              >
                Open externally
              </button>
            )}
          </div>
        )
      }
    }
  }

  const gridStyle = gridded
    ? {
        ...(active ? { boxShadow: ACTIVE_PANE_SHADOW } : {}),
        ...(gridRowSpan && gridRowSpan > 1 ? { gridRow: `span ${gridRowSpan}` } : {}),
        ...(gridColSpan && gridColSpan > 1 ? { gridColumn: `span ${gridColSpan}` } : {})
      }
    : { display: visibleInTabs ? 'block' : 'none' }

  return (
    <div
      onMouseDown={gridded ? onActivate : undefined}
      className={gridded
        ? `relative flex flex-col min-h-0 min-w-0 overflow-hidden rounded-lg bg-surface border transition-colors duration-150 ${
            active ? 'border-accent' : 'border-divider hover:border-fg-muted'}`
        : 'absolute inset-0'}
      style={gridStyle}
    >
      {gridded && (
        <div className={`flex items-center gap-2 h-7 shrink-0 px-2.5 border-b border-line text-xs select-none transition-colors ${
          active ? 'bg-elevated text-fg-bright' : 'bg-panel text-fg-muted'}`}>
          <FileCodeIcon className="shrink-0 text-fg-muted" />
          <span className="truncate font-medium tracking-wide" style={{ fontFamily: MONO_FONT }}>{pane.name}</span>
          <button
            aria-label={`Close ${pane.name}`}
            title="Close file"
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="ml-auto text-fg-muted hover:text-fg transition-colors"
          >
            ×
          </button>
        </div>
      )}
      <div className={gridded ? 'relative flex-1 min-h-0' : 'absolute inset-0'}>
        {saveError && (
          <div className="absolute inset-x-0 top-0 z-10 truncate bg-rose-500/90 px-3 py-1 text-xs text-white">
            Save failed: {saveError} — {pane.path}
          </div>
        )}
        {isMd && load.kind === 'text' && (
          <div className="absolute right-2 top-1.5 z-10 flex gap-0.5 rounded-md border border-line bg-elevated/90 p-0.5">
            <button aria-label="Rendered view" className={toggleBtn(mdView === 'rendered')}
              onClick={() => { flush(); onSetMdView('rendered') }}>MD</button>
            <button aria-label="Raw view" className={toggleBtn(mdView === 'raw')}
              onClick={() => onSetMdView('raw')}>Raw</button>
          </div>
        )}
        {body()}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/FilePaneView.test.tsx` → PASS (all 9). `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/FilePaneView.tsx src/renderer/src/components/FilePaneView.test.tsx
git commit -m "feat(files): FilePaneView — load/watch/auto-save with flush, per-kind rendering"
```

---

### Task 8: TabBar — union view-model

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`
- Test: `src/renderer/src/components/TabBar.test.tsx`

> Typecheck goes RED here (App.tsx still passes `terminals=`) until Task 10. Expected.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/components/TabBar.test.tsx` (read it first; adapt its existing fixtures —
they pass `terminals: Terminal[]`; the factory/props change to `items`). Convert existing
fixtures with a helper `const t = (term: Terminal): TabItem => ({ kind: 'terminal', terminal: term })`
and update prop spreads. Then append:

```tsx
describe('file tabs', () => {
  const fileItem: TabItem = { kind: 'file', pane: { id: 'p1', path: '/p/readme.md', name: 'readme.md' } }

  it('renders a file tab with the file icon and closes via X', async () => {
    const onClose = vi.fn()
    renderTabBar({ items: [t(termA), fileItem], onClose })
    const tab = screen.getByText('readme.md').closest('[role="tab"]') as HTMLElement
    expect(within(tab).getByTestId('icon-file-code')).toBeInTheDocument()
    await userEvent.click(within(tab).getByLabelText('Close readme.md'))
    expect(onClose).toHaveBeenCalledWith('p1')
  })

  it('file tab context menu offers Open externally and Close — no bulk items', async () => {
    const onOpenExternally = vi.fn(); const onClose = vi.fn()
    renderTabBar({ items: [t(termA), fileItem], onOpenExternally, onClose })
    fireEvent.contextMenu(screen.getByText('readme.md'))
    expect(screen.queryByRole('menuitem', { name: /Close other tabs/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open externally' }))
    expect(onOpenExternally).toHaveBeenCalledWith('/p/readme.md')
    fireEvent.contextMenu(screen.getByText('readme.md'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledWith('p1')
  })

  it('terminal-tab bulk close sweeps file tabs too (onClose per id; App dispatches per kind)', async () => {
    const onClose = vi.fn()
    renderTabBar({ items: [t(termA), fileItem, t(termB)], onClose })
    fireEvent.contextMenu(screen.getByText(termA.name))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }))
    expect(onClose).toHaveBeenCalledWith('p1')
    expect(onClose).toHaveBeenCalledWith(termB.id)
  })
})
```

(`termA`/`termB` = two terminal fixtures from the existing test file; reuse or define
minimal ones `{ id: 'tA', name: 'shellA', cwd: '' }`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/TabBar.test.tsx` → new tests FAIL.

- [ ] **Step 3: Implement**

Rewrite `TabBar.tsx` around a view-model:

```tsx
import type { Terminal, FilePane, ReviewStatus } from '@shared/types'
import { TerminalKindIcon, SpinnerIcon, FileCodeIcon } from './icons'

export type TabItem =
  | { kind: 'terminal'; terminal: Terminal }
  | { kind: 'file'; pane: FilePane }

const itemId = (it: TabItem) => (it.kind === 'terminal' ? it.terminal.id : it.pane.id)
const itemName = (it: TabItem) => (it.kind === 'terminal' ? it.terminal.name : it.pane.name)
```

Props become:

```tsx
export function TabBar({
  items, activeId, liveAgents, onSelect, onClose, onOpenExternally, reviewStatus, busy, attention
}: {
  items: TabItem[]
  activeId: string | null
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  onSelect: (id: string) => void
  onClose: (id: string) => void                 // App dispatches per kind: hide terminals, close files
  onOpenExternally: (path: string) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
  busy: Record<string, boolean>
  attention: Record<string, AttentionState | undefined>
}) {
```

Tab rendering: map `items`; per item render the SAME outer div (key/id/active/role) with:
- terminal: the existing icon/spinner/ReviewStatusDot/AttentionDot block (unchanged,
  reading `it.terminal`), X title stays "Hide (the terminal keeps running…)";
- file: `<FileCodeIcon className="shrink-0 text-fg-muted" />`, name, X with
  `aria-label={`Close ${name}`}` and `title="Close file"`.

Context menu block: look the item up by `menu.id`; for a FILE item return:

```tsx
        return <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: 'Open externally', onSelect: () => onOpenExternally(item.pane.path) },
          { label: 'Close', onSelect: () => onClose(item.pane.id) }
        ]} />
```

For a TERMINAL item keep the existing bulk items, computed over `items` (ids via
`itemId`), so a sweep closes/hides everything in range — App's `onClose` dispatches
per kind.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/TabBar.test.tsx` → PASS (converted + new).
`npm test` → all OTHER files still green. `npx tsc --noEmit` → errors ONLY at App.tsx's
`<TabBar>` call site.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TabBar.tsx src/renderer/src/components/TabBar.test.tsx
git commit -m "feat(tabbar): union view-model — file tabs alongside terminal tabs"
```

---

### Task 9: Sidebar — file rows + document context menu

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Test: `src/renderer/src/components/Sidebar.test.tsx`

File rows render AFTER the terminals container and BEFORE the documents block. The
document row gains a right-click menu (Open externally / Remove) and its click handler
signature changes to carry the feature id (App opens the doc IN-APP now).

- [ ] **Step 1: Write the failing tests**

In `Sidebar.test.tsx`:
1. Fixture: give feature f1 `files: [{ id: 'fp1', name: 'notes.md', path: '/p/notes.md' }]`.
2. Factory: add

```ts
    onSelectFile: noop,
    onCloseFile: noop,
    onRenameFilePane: noop,
    onMoveFile: noop,
    onOpenDocumentExternally: noop,
```

3. CHANGE the existing doc-open test: `onOpenDocument` is now called with
`('f1', '/docs/spec.md')` (featureId first).
4. Append:

```tsx
describe('file pane rows', () => {
  it('renders file rows between terminals and documents; click selects', async () => {
    const onSelectFile = vi.fn()
    renderSidebar({ onSelectFile })
    const row = screen.getByText('notes.md').closest('[data-file-id]') as HTMLElement
    const term = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    const doc = screen.getByText('spec').closest('[data-doc-id]') as HTMLElement
    expect(term.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row.compareDocumentPosition(doc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(screen.getByText('notes.md'))
    expect(onSelectFile).toHaveBeenCalledWith('fp1')
  })

  it('hover X closes; double-click renames via onRenameFilePane', async () => {
    const onCloseFile = vi.fn(); const onRenameFilePane = vi.fn()
    renderSidebar({ onCloseFile, onRenameFilePane })
    await userEvent.click(screen.getByLabelText('Close file notes.md'))
    expect(onCloseFile).toHaveBeenCalledWith('fp1')
    await userEvent.dblClick(screen.getByText('notes.md'))
    const input = screen.getByLabelText('Rename file notes.md')
    await userEvent.clear(input)
    await userEvent.type(input, 'Notes{Enter}')
    expect(onRenameFilePane).toHaveBeenCalledWith('fp1', 'Notes')
  })

  it('marks the active file row with the accent state', () => {
    const { container } = renderSidebar({ activeTerminalId: 'fp1' })
    const row = container.querySelector('[data-file-id="fp1"]') as HTMLElement
    expect(row.className).toContain('bg-accent-sel')
  })
})

describe('document row context menu', () => {
  it('right-click offers Open externally and Remove', async () => {
    const onOpenDocumentExternally = vi.fn(); const onRemoveDocument = vi.fn()
    renderSidebar({ onOpenDocumentExternally, onRemoveDocument })
    fireEvent.contextMenu(screen.getByText('spec'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open externally' }))
    expect(onOpenDocumentExternally).toHaveBeenCalledWith('/docs/spec.md')
    fireEvent.contextMenu(screen.getByText('spec'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(onRemoveDocument).toHaveBeenCalledWith('f1', 'd1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx` → new tests + the
changed doc-open test FAIL.

- [ ] **Step 3: Implement**

In `Sidebar.tsx`:

1. Props (type + destructuring): change `onOpenDocument: (featureId: string, path: string) => void`;
add:

```ts
  onSelectFile: (paneId: string) => void
  onCloseFile: (paneId: string) => void
  onRenameFilePane: (paneId: string, name: string) => void
  onMoveFile: (paneId: string, toIndex: number) => void
  onOpenDocumentExternally: (path: string) => void
```

2. `RenameKind` gains `'file'`; `commitRename` gains the branch (before the terminal
fallback):

```ts
      else if (editing.kind === 'file') onRenameFilePane(editing.id, name)
```

3. Drag types: extend `Drag`/`DropAt` unions with `{ kind: 'file'; id: string; featureId: string }`
/ `{ kind: 'file'; featureId: string; index: number }`; in `insertionFor` add:

```ts
  if (d.kind === 'file') {
    const c = root.querySelector(`[data-feature-files="${CSS.escape(d.featureId)}"]`)
    return c ? { kind: 'file', featureId: d.featureId, index: insertionFromMidpoints(rowMidpoints(c, '[data-file-id]'), y) } : null
  }
```

and in the sidebar `onDrop` add the matching branch calling `onMoveFile(d.id, to)` (mirror
the terminal branch, reading the feature's `files` for `from`).

4. Render the file rows AFTER the terminals container, BEFORE the docs block (inside the
same `<>` fragment), using the doc-row idiom with selection accents from the terminal
row idiom:

```tsx
                        {(f.files ?? []).length > 0 && (
                          <div className="ml-[18px] border-l border-divider pl-0.5" data-feature-files={f.id}>
                            {(f.files ?? []).map((p, pi) => {
                              const fActive = p.id === activeTerminalId
                              return (
                                <div key={p.id} data-file-id={p.id}
                                  onClick={() => onSelectFile(p.id)}
                                  draggable={!isEditing('file', p.id)}
                                  onDragStart={(e) => { e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; dragRef.current = { kind: 'file', id: p.id, featureId: f.id }; setDrag({ kind: 'file', id: p.id, featureId: f.id }) }}
                                  onDragEnd={clearDrag}
                                  title={p.path}
                                  className={`relative group mx-1 my-[2px] flex items-center gap-1.5 rounded-md pl-2 pr-1.5 py-[2px] text-[13px] cursor-pointer transition-colors ${drag?.kind === 'file' && drag.id === p.id ? 'opacity-40' : ''} ${
                                    fActive ? 'bg-accent-sel text-fg-bright' : 'text-fg hover:bg-hover hover:text-fg-bright'}`}>
                                  {fActive && <div className="pointer-events-none absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-accent" />}
                                  {dropAt?.kind === 'file' && dropAt.featureId === f.id && dropAt.index === pi && (
                                    <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-accent" />
                                  )}
                                  {dropAt?.kind === 'file' && dropAt.featureId === f.id && dropAt.index === (f.files ?? []).length && pi === (f.files ?? []).length - 1 && (
                                    <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />
                                  )}
                                  <FileCodeIcon className={`shrink-0 ${fActive ? 'text-accent' : 'text-fg-muted'}`} />
                                  {isEditing('file', p.id)
                                    ? renameInput(`Rename file ${p.name}`)
                                    : (
                                      <span className="flex-1 truncate"
                                        onDoubleClick={(e) => { e.stopPropagation(); startRename('file', p.id, p.name) }}>
                                        {p.name}
                                      </span>
                                    )}
                                  {!isEditing('file', p.id) && (
                                    <button aria-label={`Close file ${p.name}`} title="Close file"
                                      onClick={(e) => { e.stopPropagation(); onCloseFile(p.id) }}
                                      className={`${hoverBtn} text-base leading-none hover:text-danger`}>×</button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
```

(`FileCodeIcon` joins the icons import.)

5. Doc rows: change the click to `onNameClick(() => onOpenDocument(f.id, d.path))` and
add `onContextMenu` storing `docMenu = { x, y, featureId: f.id, docId: d.id, path: d.path }`
state; render next to the other menus:

```tsx
      {docMenu && (
        <ContextMenu x={docMenu.x} y={docMenu.y} onClose={() => setDocMenu(null)} items={[
          { label: 'Open externally', onSelect: () => onOpenDocumentExternally(docMenu.path) },
          { label: 'Remove', onSelect: () => onRemoveDocument(docMenu.featureId, docMenu.docId) }
        ]} />
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx` → PASS. `npm test` →
all green. `npx tsc --noEmit` → errors only at App.tsx call sites (Sidebar + TabBar).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): file pane rows + document open-externally context menu"
```

---

### Task 10: App wiring — union tabs/grid, shortcuts, entry points

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/TerminalView.tsx`, `src/renderer/src/components/TerminalPane.tsx`

Turns typecheck GREEN. No new unit tests (App has no harness; every logic piece is
already unit-tested) — acceptance is typecheck + suite + smoke (Task 12).

- [ ] **Step 1: Terminal link → in-app**

`TerminalView.tsx`: add optional prop `onOpenFile?: (path: string) => void` (type +
destructure). In the link `activate` handler replace `window.brain.openPath(target)` with:

```ts
              activate: (e: MouseEvent) => { if (e.ctrlKey || e.metaKey) (onOpenFile ?? window.brain.openPath)(target) }
```

`TerminalPane.tsx`: add the same optional prop and thread it:
`<TerminalView terminal={terminal} active={active} resume={resume} onOpenFile={onOpenFile} />`.

- [ ] **Step 2: App — handlers and derived state**

In `App.tsx`:

1. Imports: extend the `./store` import with
`openFile, closeFile, moveFile, renameFilePane, setFilePaneMdView, findFilePane`; add
`import { FilePaneView } from './components/FilePaneView'`; extend the TabBar import:
`import { TabBar, type TabItem } from './components/TabBar'`.

2. Helpers (after `addDocumentTo`):

```ts
  const isFilePaneId = (id: string | null): boolean => !!id && !!findFilePane(state, id)
  // Close = remove (content is auto-saved; FilePaneView flushes on unmount).
  const closePane = (id: string) =>
    apply((s) => (findFilePane(s, id) ? closeFile(s, id) : hideTerminal(s, id)))
```

3. Ctrl+Shift+W branch becomes:

```ts
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') {           // close file pane / hide terminal
        e.preventDefault()
        if (state.activeTerminalId) closePane(state.activeTerminalId)
      }
```

4. `cycleTab` cycles the union and skips `markStarted` for files:

```ts
    const cycleTab = (dir: number) => {
      const f = getActiveFeature(state)
      const visible: { id: string; file: boolean }[] = [
        ...(f?.terminals.filter((t) => !state.hidden.includes(t.id)).map((t) => ({ id: t.id, file: false })) ?? []),
        ...((f?.files ?? []).map((p) => ({ id: p.id, file: true })))
      ]
      if (visible.length === 0) return
      const idx = visible.findIndex((v) => v.id === state.activeTerminalId)
      const next = visible[(idx + dir + visible.length) % visible.length]
      if (!next.file) markStarted(next.id)
      apply((s) => setActiveTerminal(s, next.id))
    }
```

5. Derived pane lists (replace the current `featureVisible`/layout block):

```ts
  const featureVisible = (activeFeature?.terminals ?? []).filter((t) => !state.hidden.includes(t.id))
  const featureFiles = activeFeature?.files ?? []
  const gridMode = (activeFeature?.viewMode ?? 'tabs') === 'grid'
  const featureTerminalIds = new Set(featureVisible.map((t) => t.id))
  const paneCount = featureVisible.length + featureFiles.length
  const { cols, rows, lastSpan, spanFirst, flow: gridFlow } = styledGridLayout(paneCount, activeFeature?.gridStyle ?? 'auto')
  const combinedIds = [...featureVisible.map((t) => t.id), ...featureFiles.map((p) => p.id)]
  const spanPaneId = spanFirst ? combinedIds[0] : combinedIds[combinedIds.length - 1]
  const tabItems: TabItem[] = [
    ...featureVisible.map((t) => ({ kind: 'terminal' as const, terminal: t })),
    ...featureFiles.map((p) => ({ kind: 'file' as const, pane: p }))
  ]
```

(`spanTerminalId` is replaced by `spanPaneId` — update the two `TerminalPane` span props
to compare against `spanPaneId`.)

6. TabBar call site:

```tsx
        <TabBar
          items={tabItems}
          activeId={state.activeTerminalId}
          liveAgents={liveAgents}
          busy={busy}
          onSelect={(id) => { if (!isFilePaneId(id)) markStarted(id); apply((s) => setActiveTerminal(s, id)) }}
          onClose={closePane}
          onOpenExternally={(p) => window.brain.openPath(p)}
          reviewStatus={reviewStatus}
          attention={attention.attention}
        />
```

7. Empty placard condition becomes `paneCount === 0 && (...)`:

```tsx
          {paneCount === 0 && (
```

8. Render file panes of the ACTIVE feature after the `terminals.map(...)` block (they
mount only while their feature is active — no process to keep alive):

```tsx
          {featureFiles.map((p) => (
            <FilePaneView
              key={p.id}
              pane={p}
              active={p.id === state.activeTerminalId}
              gridded={gridMode}
              gridRowSpan={gridMode && gridFlow === 'column' && p.id === spanPaneId ? lastSpan : undefined}
              gridColSpan={gridMode && gridFlow === 'row' && p.id === spanPaneId ? lastSpan : undefined}
              visibleInTabs={!gridMode && p.id === state.activeTerminalId}
              onActivate={() => apply((s) => setActiveTerminal(s, p.id))}
              onClose={() => apply((s) => closeFile(s, p.id))}
              onSetMdView={(v) => apply((s) => setFilePaneMdView(s, p.id, v))}
              onOpenExternally={() => window.brain.openPath(p.path)}
            />
          ))}
```

9. Open-file entry points:

```ts
  const openFileIn = (featureId: string | null, path: string) => {
    if (!featureId) return
    apply((s) => openFile(s, featureId, { path }))
  }
```

- Sidebar props: replace `onOpenDocument={(p) => window.brain.openPath(p)}` with
  `onOpenDocument={(fid, p) => openFileIn(fid, p)}`; add
  `onOpenDocumentExternally={(p) => window.brain.openPath(p)}`,
  `onSelectFile={(id) => apply((s) => setActiveTerminal(s, id))}`,
  `onCloseFile={(id) => apply((s) => closeFile(s, id))}`,
  `onRenameFilePane={(id, name) => apply((s) => renameFilePane(s, id, name))}`,
  `onMoveFile={(id, toIndex) => apply((s) => moveFile(s, id, toIndex))}`.
- TerminalPane gets `onOpenFile={(path) => openFileIn(featureIdOfTerminal(state, t.id), path)}`
  (add `featureIdOfTerminal` to the `./store` import).

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → GREEN (zero errors — the acceptance gate). `npm test` → all green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/TerminalView.tsx src/renderer/src/components/TerminalPane.tsx
git commit -m "feat(app): file panes in tabs/grid/shortcuts; docs and terminal links open in-app"
```

---

### Task 11: Import/export carry file panes

**Files:**
- Modify: `src/renderer/src/importRemap.ts`
- Test: `src/renderer/src/importRemap.test.ts`, `src/main/exportImport.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('buildImport — archive and documents')` block in
`importRemap.test.ts` (extend its `withExtras` group's first feature with
`files: [{ id: 'fp1', name: 'notes', path: '/old/proj/notes.md', mdView: 'raw' as const }]`):

```ts
  it('file panes carry through with fresh ids, verbatim paths, and mdView; never in terminalIds', () => {
    const out = build()
    const files = out.group!.features[0].files!
    expect(files).toHaveLength(1)
    expect(files[0].id).toMatch(/^new-/)
    expect(files[0]).toMatchObject({ name: 'notes', path: '/old/proj/notes.md', mdView: 'raw' })
    expect(out.terminalIds).not.toContain(files[0].id)
  })
```

Append to `src/main/exportImport.test.ts`'s round-trip describe (extend `withExtras`'s
feature with the same `files` entry):

```ts
    expect(g.features[0].files![0]).toMatchObject({ name: 'notes', path: '/old/proj/notes.md' })
```

(One added assertion inside the existing round-trip test is enough — the manifest carries
the `Feature` object verbatim.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/importRemap.test.ts` → the new test FAILS (files dropped).
The exportImport assertion may already pass — fine; it pins the behavior.

- [ ] **Step 3: Implement**

In `importRemap.ts`, `importFeature` gains (next to the documents line):

```ts
    // Open-file panes: fresh ids, VERBATIM paths (dead ones show the missing
    // fallback), persisted mdView kept. Never spawn-gated — not in terminalIds.
    ...(f.files?.length
      ? { files: f.files.map((p) => ({ id: createId(), name: p.name, path: p.path, ...(p.mdView ? { mdView: p.mdView } : {}) })) }
      : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/importRemap.test.ts src/main/exportImport.test.ts` → PASS.
`npm test && npm run typecheck` → green/clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/importRemap.ts src/renderer/src/importRemap.test.ts src/main/exportImport.test.ts
git commit -m "feat(import): carry file panes through buildImport"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass, no type errors, build succeeds.

- [ ] **Step 2: Manual smoke test** (`npm run dev`)

1. Click a feature document → opens as a tab IN the app; `.md` shows rendered; the
   MD/Raw toggle switches to the editor and back; toggle state survives a restart.
2. Edit a file, stop typing ~1 s, check the file on disk → content saved. Type and
   IMMEDIATELY switch tabs → content still saved (flush).
3. `echo more >> file` from a terminal while the pane is open and idle → pane updates.
4. Open a `.png` → renders; open a binary → fallback + Open externally works.
5. Grid view → file panes appear as cells after terminals; X on a file cell closes it;
   big-pane span styles still look right with mixed panes.
6. Ctrl+click a file path printed in a terminal → opens in that terminal's feature.
7. Ctrl+Shift+W on a file tab closes it; on a terminal tab hides it. Ctrl+PgUp/PgDn
   cycles through terminals AND files.
8. Right-click a document row → Open externally still opens the default app.
9. Hide the last terminal of a feature that has a file open → the file pane is selected,
   no empty placard.
10. Restart the app → open file panes are back (cold content reload, no PTY side effects).
11. Export a project with open file panes → import it → panes present with fresh ids.

- [ ] **Step 3: Wrap up the branch**

Use the superpowers:finishing-a-development-branch skill (user's convention: `--no-ff`
merge into `develop`, push only after explicit confirmation).

# File Panes — In-App File Viewing & Editing — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Open files directly inside the app: any file type is loaded and shown if possible
(text → editable editor, images → picture, binary → fallback), markdown renders
formatted with a toggle to raw editing. An open file is a first-class pane of a
feature — it appears in the tab bar, in the grid view, and in the sidebar, and it
persists across restarts.

## Scope

- New `FilePane` entity on `Feature` (parallel to `terminals`, never mixed into it).
- Entry points: clicking a feature document in the sidebar and Ctrl+click on a file
  path in a terminal both open the file IN-APP; "Open externally" remains available
  via context menus.
- CodeMirror 6 editor with auto-save; markdown rendered/raw toggle; image display;
  binary/missing/too-large fallbacks.
- External-change handling via the existing fs-watch IPC.
- Out of scope: interleaved ordering of file panes between terminals (files always
  render after terminals), file tree/browser, creating new files from the app,
  multi-cursor/LSP features, image editing.

## Approach

Parallel array (`Feature.files`), NOT a union pane type and NOT files-as-terminals:
every PTY-centric subsystem (reaper, spawn gating, attention, review, agent session
export) iterates `feature.terminals` only and stays untouched. In the tab bar, grid,
and sidebar, file panes render AFTER the terminals — mirroring how the documents
section already sits after terminal rows.

## Data model (`src/shared/types.ts`)

```ts
export interface FilePane {
  id: string
  path: string                  // absolute path on disk
  name: string                  // display name; defaults to the file's basename
  mdView?: 'rendered' | 'raw'   // markdown view state; undefined === 'rendered'
}

export interface Feature {
  // ...existing...
  files?: FilePane[]            // undefined === []
}
```

- `migrateWorkspace` sanitizes `files` exactly like `documents`: entries without a
  string non-empty `path` are dropped; missing ids/names filled (name = basename);
  `mdView` kept only when `'rendered' | 'raw'`; empty list → field omitted.
- Export/import: `files` rides inside the `Feature` object with no manifest format
  change. Import (`importRemap.buildImport`) carries file panes with FRESH ids and
  VERBATIM paths (same decision as documents — dead paths show the missing fallback).
  File panes never contribute to `BuiltImport.terminalIds` (nothing spawn-gates them).
- Archived features carry their `files` untouched; restore brings the panes back
  (no PTY interaction — nothing else to re-seed).

## IPC (`src/main`)

New module `src/main/fileLoad.ts` (pure, unit-tested) + handlers in `ipc.ts`:

- `file:load` (invoke) `{ path }` →
  - `{ kind: 'text', content: string }` — UTF-8 text up to 2 MB
  - `{ kind: 'image', dataUrl: string }` — extension-based (png jpg jpeg gif webp svg
    bmp ico avif), up to 20 MB, returned as a base64 data URL (a `file://` src does
    not load from the dev-server origin)
  - `{ kind: 'binary' }` — null byte in the first 8 KB or invalid UTF-8
  - `{ kind: 'too-large', size: number }` — text over 2 MB
  - `{ kind: 'missing' }` — unreadable/nonexistent
- `file:save` (invoke) `{ path, content }` → `{ ok: true } | { ok: false; error: string }`.
- `shell:openExternal` (send) `{ url }` → `shell.openExternal` — needed by
  MarkdownView's link interception (`BrainApi.openPath` wraps `shell.openPath`, which
  opens filesystem paths, not `http(s)` URLs). The fallback panel's "Open externally"
  button keeps using `openPath` — its target IS a file path.
- `BrainApi`: `loadFile(path)`, `saveFile(path, content)`, `openExternal(url)`.
- Watching reuses the existing `fsWatch` / `fsUnwatch` / `fsChanged` channels with
  `watchId = pane id`.
- Image rules: an image over 20 MB returns `{ kind: 'too-large', size }` (same shape
  as oversized text); an image whose read fails returns `{ kind: 'missing' }`.
- Overlap note: `BrainApi.readTextFile` (the `fs:read` channel) already exists and
  stays as-is — the review loop depends on it. `file:load` is a separate, richer
  surface (kind detection, limits, images); do NOT merge the two.

## Store (`src/renderer/src/store.ts`)

- `openFile(state, featureId, input: { path: string; name?: string; id?: string })` —
  if the feature already has a pane with that `path`, just activate it; otherwise
  append `{ id, path, name: name ?? basename }` and activate it. Active features only.
- `closeFile(state, paneId)` — remove the pane (no confirm — content is auto-saved);
  if it was active, selection falls to the feature's first visible terminal, else its
  first file pane, else null.
- `moveFile(state, paneId, toIndex)` — reorder within the feature's `files` (mirrors
  `moveTerminal`).
- `renameFilePane(state, paneId, name)` — display name only; the path never changes.
- `setFilePaneMdView(state, paneId, view: 'rendered' | 'raw')`.
- `activeTerminalId` becomes the generic "active pane id": it may hold a file pane id.
  A comment on the field documents this. Consumers of the raw id, enumerated:
  - **Selectors** (`getActiveTerminal`, …) return null for a file id — their callers
    already handle null. Fine as-is.
  - **Ctrl+Shift+W** (App): if the active pane is a FILE pane, `closeFile` it instead
    of `hideTerminal` (matching the file tab's X semantics: close, not hide). A file
    pane id must never enter `state.hidden`.
  - **Selection fallbacks** — `hideTerminal`, `removeTerminal`, `closeFile`, and the
    grid→tabs collapse in `toggleFeatureViewMode` all use ONE uniform rule:
    first visible terminal, else first file pane, else null.
  - **`markStarted` / spawn-gate paths** (cycleTab, pane activation in App) skip file
    pane ids — `startedIds` and the boot/resume sets stay terminal-only.
- Tab cycling (Ctrl+PgUp/PgDn) and `selectFeature` iterate visible terminals THEN
  file panes.

## Renderer components

- **`FilePaneView.tsx`** — one open file. Loads via `loadFile` on mount and on
  `fsChanged`; renders by kind: CodeEditor (text), rendered markdown or CodeEditor
  (`.md`, per `mdView`), `<img>` (image, read-only), fallback panel with the reason +
  an "Open externally" button (binary / too-large / missing). The `.md` pane shows a
  small Rendered ⇄ Raw toggle in its top-right corner.
- **`CodeEditor.tsx`** — CodeMirror 6 wrapper (`@uiw/react-codemirror`), language by
  filename via `@codemirror/language-data` (lazy), small custom dark theme from the
  app palette.
- **`MarkdownView.tsx`** — `react-markdown` + `remark-gfm`; links open externally
  (intercepted, sent to `shell.openPath`/`openExternal`); styled minimally to match
  the app (no typography plugin).

### Auto-save & external changes

- Every edit schedules a debounced (~500 ms) `saveFile`. No dirty indicator, no
  save button (user decision).
- The pane watches its file. On `fsChanged`: reload content; if it equals the last
  content WE wrote → ignore (self-echo); if the editor has no pending unsaved edits →
  silently replace the doc; if the user has pending edits → skip the reload — the
  debounced save wins (accepted last-writer-wins semantics).
- A failed save shows a slim error strip inside the pane (message + the path); the
  next edit retries automatically. The strip clears on the first successful save.
- The pending debounced save is FLUSHED, never dropped — this is the integrity
  condition the whole no-save-button UX rests on: (a) on editor unmount (tab/feature
  switch, md rendered⇄raw toggle, grid toggle); (b) by `closeFile`'s caller before
  the pane is removed; (c) on `window` `beforeunload` (fire-and-forget `saveFile` —
  the main process outlives the renderer). A pane is never unmounted or closed with
  unsaved edits.

## UI integration

- **TabBar** moves to a view-model list: `{ id, kind: 'terminal' | 'file', name, … }`.
  Terminal tabs keep busy/review/attention adornments (keyed by id); file tabs show a
  doc icon and an X that CLOSES the pane (removes it — unlike terminal X which hides).
  File tab context menu: Open externally, Close (no bulk items). The terminal tabs'
  bulk items (Close others / to the left / to the right) dispatch PER KIND across the
  affected range: terminals are hidden, file panes are closed.
- **Grid** — `styledGridLayout(visibleTerminals + files)`; file panes are equal grid
  cells rendered after the terminals; the X on a gridded file pane closes it. The
  span (big pane) logic operates on the combined list. File panes are NOT grid
  drag-and-drop sources or targets (grid DnD computes indices against
  `feature.terminals`); file reordering is sidebar-only (`moveFile`).
- **Empty state** — the "Brain" placard renders only when the feature has no visible
  terminals AND no file panes.
- **Sidebar** — file rows inside an expanded feature AFTER the terminal rows and
  BEFORE the documents section: doc icon + name, click activates the pane,
  double-click renames (display name), hover X closes, drag-reorder among file rows
  (new drag kind, mirrors terminals).
- **Entry points** — sidebar document row click → `openFile` into that feature
  (replaces the previous `openPath` behavior; "Open externally" added to the document
  row's hover/context affordances). Ctrl+click on a resolved path link in a terminal →
  `openFile` into THAT terminal's feature (replaces `openPath`).
- Unlike terminals (which stay mounted forever to keep their PTY alive), file panes
  mount only while their FEATURE is active: all panes of the active feature stay
  mounted (inactive ones `display: none`, like TerminalPane) so editor scroll/undo
  and the pending-save timer survive within-feature tab switches; switching features
  or closing the pane unmounts it (with a flush) and content reloads on next mount.

## Dependencies (new)

`@uiw/react-codemirror`, `@codemirror/language-data`, `react-markdown`, `remark-gfm`.

## Testing

- `fileLoad.test.ts` — text/image/binary/too-large/missing detection against tmp files.
- `store.test.ts` — openFile dedupe+activate, closeFile selection fallback, moveFile,
  renameFilePane, setFilePaneMdView, interaction with archive (files ride along);
  the uniform selection fallback (terminal → file pane → null) in `hideTerminal`,
  `removeTerminal`, and `toggleFeatureViewMode`'s grid→tabs collapse; file ids never
  enter `hidden`.
- `migrate.test.ts` — `files` sanitizing (garbage, basename fallback, mdView values).
- `importRemap.test.ts` — file panes: fresh ids, verbatim paths, not in terminalIds.
- `FilePaneView.test.tsx` — kind rendering, md toggle, auto-save debounce (fake
  timers, mocked `window.brain`), external-change reload rules, and flush-on-unmount:
  unmount mid-debounce still saves.
- `TabBar.test.tsx` — union view-model: file tabs render, X closes, terminal tabs
  unchanged; bulk close items dispatch per kind (terminals hidden, files closed).
- `Sidebar.test.tsx` — file rows after terminals/before docs, activate, rename,
  close, reorder.

UI labels English, consistent with the app.

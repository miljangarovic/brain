# Feature Archive + Feature Documents — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Two extensions to the Group → Feature → Terminal hierarchy:

1. **Archive** — a feature can be archived: it leaves the active sidebar list, its terminal
   processes stop, and it can later be restored (terminals respawn, agents resume their
   sessions). A per-project modal manages archiving and restoring.
2. **Documents** — a feature can reference documents on disk (spec, plan, anything else).
   They render in the sidebar as a section after the feature's terminals and open in the
   system default application on click.

## Scope

- Per-project archive: move features out of / back into the active list.
- A new context menu on feature rows: rename, add terminal (Claude / Codex / shell),
  add document, archive.
- Feature documents as file references with a broken-file indicator.
- Out of scope: document reordering, in-app document viewer/editor, archiving groups or
  terminals, any automatic document discovery.

## Data model (`src/shared/types.ts`)

```ts
export interface FeatureDoc {
  id: string
  name: string   // display name; defaults to the file's basename
  path: string   // absolute path on disk
}

export interface Feature {
  // ...existing fields...
  documents?: FeatureDoc[]      // undefined === []
}

export interface Group {
  // ...existing fields...
  archivedFeatures?: Feature[]  // undefined === []
}
```

Archiving **moves** the feature object from `group.features` to `group.archivedFeatures`
(appended; archive order = archive time). Because archived features vanish from the
workspace tree that everything else iterates, no other subsystem needs to know about the
archive:

- the PTY reaper kills the PTYs of terminals that no longer exist in the workspace —
  archiving stops processes with zero new code in the spawn/reap path;
- sidebar drag-drop, selection, attention routing, review lookups, and the tab bar all
  keep operating on `group.features` only.

Restore moves the feature back to the **end** of `group.features`. Its terminals mount
fresh, exactly like after an app restart: shells start clean, agent terminals resume
their conversation via the persisted `sessionId` (existing behavior).

`migrateWorkspace` sanitizes both new fields: `archivedFeatures` entries go through the
same `sanitizeFeature` as active ones; `documents` entries missing an id/name/path are
dropped. Absent fields stay absent (undefined === []).

## Store operations (`src/renderer/src/store.ts`)

- `archiveFeature(state, featureId)` — move active → archived. If it was the active
  feature, selection falls to the group's first remaining feature (same rule as
  `deleteFeature`). Its terminals' ids are pruned from `hidden`.
- `restoreFeature(state, featureId)` — move archived → end of active. Does **not** change
  the active selection (the modal stays open for batch operations).
- `deleteArchivedFeature(state, featureId)` — permanently remove a feature from the
  archive (UI confirms first).
- `addDocument(state, featureId, { name, path })`, `renameDocument(state, featureId, docId, name)`,
  `removeDocument(state, featureId, docId)` — manage `feature.documents`. Removing a
  document removes the reference only; the file on disk is untouched.

## Sidebar (`src/renderer/src/components/Sidebar.tsx`)

### Feature context menu (new)

Right-click on a feature row opens a `ContextMenu` (flat items — the component has no
submenus) with:

1. `Rename`
2. `New Claude` / `New Codex` / `New Terminal` — same icons and handlers as the existing
   `AddMenuButton` on the feature row
3. `Add document…`
4. `Archive`

### Documents section

Inside an expanded feature, **after all terminal rows**, one row per document:

- doc icon + name; click → open via the existing `shell.openPath` IPC
- double-click → inline rename (existing rename input pattern)
- hover trash → remove the reference
- if the file does not exist on disk the row renders muted/“broken” with a warning title

File existence uses a new IPC `fs:pathsExist(paths: string[]) → boolean[]`, checked when
the docs section renders and re-checked on window focus.

### Archive row

At the bottom of each group's feature list (below the `+ Feature` input): a discreet,
always-visible row `Archive (N)`. Click opens the ArchiveDialog for that group.

## ArchiveDialog (new component)

Modeled on the existing dialog components; operates on a single group. Two sections:

- **Active** — per row: feature name, terminal count, an `Archive` button
- **Archived** — per row: feature name, terminal count, a `Restore` button, and a trash
  button (permanent delete behind a `ConfirmDialog`)

The dialog stays open after each action so several features can be moved in one visit.
It closes on X, Escape, or a click outside.

## Add document flow

`Add document…` (feature context menu) → existing `pickFile` dialog with
`defaultPath = group.cwd` → on pick, the document is added with `name = basename(path)`
and the sidebar immediately opens its inline rename (reusing the pending-rename pattern
used for fresh terminals). Cancelling the picker adds nothing. Picking a path the feature
already references is a no-op (no duplicate rows).

## Interaction with export/import

The export manifest carries full `Group`/`Feature` objects, so `archivedFeatures` and
`documents` ride along with no format change. Import runs the manifest through
`migrateWorkspace`, which sanitizes both fields. Document paths are absolute, so on
another machine they will typically not exist — the broken-file indicator covers that;
no special import handling.

## Testing

Vitest, mirroring existing suites:

- `store.test.ts` — archive/restore/permanent-delete (including active-selection and
  `hidden` pruning), document add/rename/remove
- `migrate.test.ts` — sanitizing `archivedFeatures` and `documents`, garbage entries
- `Sidebar.test.tsx` — feature context menu items and handlers, docs section rendering,
  broken-doc state, archive row count and click
- `ArchiveDialog.test.tsx` — both sections, archive/restore/delete-with-confirm flows

UI labels are English, consistent with the rest of the sidebar.

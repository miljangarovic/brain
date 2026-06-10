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

Restore moves the feature back to the **end** of `group.features`. Its terminals must
behave exactly like terminals present at first load: shells start clean, agent terminals
resume their conversation via the persisted `sessionId`, and every restored terminal
stays **cold** (no PTY) until the user opens it — restoring a feature with many
terminals must not launch everything at once.

This does NOT come for free: `App.tsx` seeds `resumeIdsRef` (agent terminals that resume)
and `bootIdsRef` (terminals that stay cold) **once, at initial load** — a feature restored
mid-session would otherwise auto-spawn all its terminals with their plain startup commands.
Restore therefore also appends the restored ids to both refs: agent terminal ids
(claude/codex with a `sessionId`) to `resumeIdsRef`, all restored ids to `bootIdsRef`.

`migrateWorkspace` sanitizes both new fields: `archivedFeatures` entries go through the
same `sanitizeFeature` as active ones; `documents` entries missing an id/name/path are
dropped. Absent fields stay absent (undefined === []).

## Store operations (`src/renderer/src/store.ts`)

- `archiveFeature(state, featureId)` — move active → archived. Archiving a non-active
  feature changes no selection. Archiving the active feature reselects within its group
  by the same `selectFeature` rule `deleteFeature` uses: first remaining feature and its
  first visible terminal, or `activeFeatureId`/`activeTerminalId` = null when the group
  has no active features left. `activeGroupId` is untouched — by the existing selection
  invariant the active feature's group is already the active group. Its terminals' ids
  are pruned from `hidden`.
- `restoreFeature(state, featureId)` — move archived → end of active. Does **not** change
  the active selection (the modal stays open for batch operations).
- `deleteArchivedFeature(state, featureId)` — permanently remove a feature from the
  archive (UI confirms first).
- `addDocument(state, featureId, { name, path })`, `renameDocument(state, featureId, docId, name)`,
  `removeDocument(state, featureId, docId)` — manage `feature.documents`. These operate
  on **active features only**; an archived feature's documents are carried along untouched
  and become editable again after restore. Removing a document removes the reference only;
  the file on disk is untouched.

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

File existence uses the already-reserved `IPC.fsExists` channel (`'fs:exists'` in
`src/shared/ipc.ts`, currently unused): an `invoke` handler in `src/main/ipc.ts` takes
`{ paths: string[] }` and returns `boolean[]`, exposed to the renderer as
`BrainApi.pathsExist(paths: string[]): Promise<boolean[]>` via the preload. Checked when
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
It closes on X, Escape, or a click outside — the same inline pattern `ConfirmDialog` and
`NewGroupDialog` already implement (fixed backdrop with `onClick` cancel + window Escape
listener); no new modal primitive is needed.

## Add document flow

`Add document…` (feature context menu) → existing `pickFile` dialog with
`defaultPath = group.cwd` → on pick, the document is added with `name = basename(path)`
and the sidebar immediately opens its inline rename (reusing the pending-rename pattern
used for fresh terminals). Cancelling the picker adds nothing. Picking a path the feature
already references is a no-op (no duplicate rows).

## App ↔ Sidebar wiring

`App.tsx` owns the new state and passes handlers down, following the existing
prop-driven pattern:

- App state: `archiveDialogGroupId: string | null` (which group's ArchiveDialog is open),
  `pendingRenameDocId: string | null` (mirrors `pendingRenameTerminalId` for the
  add-document inline rename).
- New `Sidebar` props: `onOpenArchive(groupId)`, `onArchiveFeature(featureId)`,
  `onAddDocument(featureId)` (App runs the `pickFile` flow), `onRenameDocument(featureId, docId, name)`,
  `onRemoveDocument(featureId, docId)`, `onOpenDocument(path)`, plus
  `pendingRenameDocId` / `onPendingRenameDocConsumed`.
- `ArchiveDialog` is rendered by App (like the other dialogs) with the group's active +
  archived features and `onArchive` / `onRestore` / `onDeleteArchived` handlers; permanent
  delete goes through the existing `ConfirmDialog`.
- Restore wiring in App appends restored terminal ids to `resumeIdsRef` / `bootIdsRef`
  (see Data model above).

## Interaction with export/import

The export manifest carries full `Group`/`Feature` objects, so `archivedFeatures` and
`documents` ride along with no format change. Import runs the manifest through
`migrateWorkspace`, which sanitizes both fields. Document paths are absolute, so on
another machine they will typically not exist — the broken-file indicator covers that;
no special import handling.

One real gap: `collectAgentSessions` in `src/main/exportImport.ts` iterates only
`group.features`, so archived agent terminals would appear in the manifest but get no
session summary — and after import on another machine (where `sessionId` is useless)
a restored feature's agents would wake with no context. For group-scope exports it must
also walk `group.archivedFeatures ?? []`.

## Testing

Vitest, mirroring existing suites:

- `store.test.ts` — archive/restore/permanent-delete (including active-selection rules,
  empty-group selection, and `hidden` pruning), document add/rename/remove/duplicate-path
- `migrate.test.ts` — sanitizing `archivedFeatures` and `documents`, garbage entries
- `Sidebar.test.tsx` — feature context menu items and handlers, docs section rendering,
  broken-doc state (mocked `pathsExist`), archive row count and click
- `ArchiveDialog.test.tsx` — both sections, archive/restore/delete-with-confirm flows,
  Escape and outside-click close
- `exportImport.test.ts` — group-scope session collection includes archived features;
  manifest round-trips `archivedFeatures` and `documents`
- App-level test for restore: restored agent terminals resume (ids land in the
  resume/boot sets) rather than cold-launching their startup command

UI labels are English, consistent with the rest of the sidebar.

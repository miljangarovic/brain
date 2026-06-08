# Feature reorder (drag-and-drop within a project)

## Goal

Let the user reorder features within a project by dragging a feature row up or
down in the sidebar. Order is persisted with the workspace.

## Scope

In scope:
- Drag-and-drop reordering of features **within the same project (group)**.

Out of scope (YAGNI for now):
- Reordering terminals within a feature.
- Reordering projects (groups).
- Dragging a feature into a different project (re-parenting).

## Interaction

- The **whole feature row is draggable** (no separate grip handle — it would eat
  horizontal space). A plain single-click still collapses and a double-click
  still renames, because HTML5 drag only starts once the pointer actually moves.
  Dragging is disabled while the feature is being renamed. The row shows a
  grab cursor and dims (opacity) while it is the one being dragged.
- While dragging anywhere within the **same** project's feature area, a thin
  accent line marks the insertion point (computed from the cursor's Y against the
  feature rows' midpoints). Dragging above the first row marks the first
  position; below the last row (e.g. over the `+ Feature` input) marks the last.
- Dropping moves the dragged feature to the indicated position.
- If the cursor is over a **different** project, no indicator is shown and a drop
  is ignored (reorder is within-project only).
- Reordering does not change which feature/terminal is currently active.

## State / logic (`store.ts`)

New pure reducer function:

```ts
moveFeature(state: AppState, featureId: string, toIndex: number): AppState
```

- Finds the group that owns `featureId`.
- Removes the feature from its current index and re-inserts it at `toIndex`
  within that same group's `features` array.
- `toIndex` is clamped to `[0, features.length - 1]` after removal semantics
  (an out-of-range or no-op move returns equivalent order).
- Other groups are untouched; the feature keeps all its terminals.
- `activeGroupId` / `activeFeatureId` / `activeTerminalId` are unchanged.

Index convention: `toIndex` is the **desired final 0-based position** of the
feature within its group after the move. Implementation = remove the feature
from its current index, then insert it at `clamp(toIndex, 0, len-1)` in the
resulting (shorter) array — so the feature ends up exactly at `toIndex`.

The UI is responsible for translating a drop ("above/below feature at display
index `over`") into this final index, accounting for the removal of the dragged
item:

```
insertionPoint = above ? over : over + 1          // in the original array
toIndex        = insertionPoint > from ? insertionPoint - 1 : insertionPoint
```

## UI (`Sidebar.tsx`)

- Add `onMoveFeature: (featureId: string, toIndex: number) => void` to the
  Sidebar props.
- Drag state is held in React state (the dragged `featureId` + its `groupId`,
  and a `dropAt` for the indicator) rather than relying on `dataTransfer`
  payload — this keeps it testable.
- The whole feature row (`<div draggable>` with `data-feature-id`) starts the
  drag: `onDragStart` records `{ featureId, groupId }` (in a ref so dragover/drop
  read it synchronously), `onDragEnd` clears it.
- The drop target is the **group's features container** (`data-group-features`),
  not the individual rows — so dropping above the first row or below the last
  (e.g. over the `+ Feature` input) still resolves to a valid position:
  - `onDragOver`: if the drag belongs to this group, `preventDefault()` +
    `dropEffect='move'`, and set the insertion index from the cursor Y vs the
    feature rows' midpoints; if it belongs to another group, clear the indicator.
  - `onDrop`: convert the insertion point to the final index and call
    `onMoveFeature` (skipping a no-op move).
- The insertion line is an absolute, `pointer-events-none` element positioned at
  the top of the row at the insertion index (or the bottom of the last row when
  inserting at the end) — it never shifts layout or steals the drop target.
- Two exported pure helpers carry the math, unit-tested directly (cursor geometry
  is not exercised in jsdom): `insertionFromMidpoints(midpoints, cursorY)` →
  insertion point `0..n`; `reorderToIndex(insertion, fromIndex)` → final index.

## App wiring (`App.tsx`)

Pass `onMoveFeature={(featureId, toIndex) => apply((s) => moveFeature(s, featureId, toIndex))}`
to `<Sidebar>`. No other changes.

## Persistence

None required. `App` already saves `state.workspace` whenever it changes, so the
new order is persisted automatically and restored on launch.

## Testing

`store.test.ts`:
- moves a feature down within its group.
- moves a feature up within its group.
- a no-op move (same position) leaves order unchanged.
- clamps an out-of-range `toIndex`.
- leaves features of other groups untouched.
- preserves the moved feature's terminals.
- leaves active selection unchanged.

`Sidebar.test.tsx`:
- `insertionFromMidpoints` (above first → 0, between rows → next index, below
  last → past the end) and `reorderToIndex` (down-shift / up keeps point).
- feature rows are `draggable`; `dragStart` on a row then `drop` on the project's
  features zone calls `onMoveFeature('id', <number>)` (wiring).
- dropping on a different project than the dragged feature does not call
  `onMoveFeature`.

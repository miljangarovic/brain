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

- A grip handle (⠿) appears on hover at the left of each feature row, next to
  the existing collapse caret. Only the handle initiates the drag (the row
  becomes `draggable` on handle `mousedown`); this keeps the existing
  single-click-collapse and double-click-rename behavior intact. Dragging is
  disabled while the feature is being renamed.
- While dragging over a feature row in the **same** project, a thin accent line
  is drawn above or below the row (chosen by whether the cursor is in the top or
  bottom half of the row) to indicate the drop position.
- Dropping moves the dragged feature to the indicated position.
- If the cursor is over a feature in a **different** project, no indicator is
  shown and a drop is ignored (reorder is within-project only).
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
- Drag state is held in a React ref/state (the dragged `featureId` and its
  `groupId`) rather than relying on `dataTransfer` payload — this keeps it
  testable under jsdom.
- Handlers on each feature row:
  - `onDragStart`: record `{ featureId, groupId }`.
  - `onDragOver`: if same group, `preventDefault()` and set the drop indicator
    (target index + above/below) based on cursor Y vs the row midpoint.
  - `onDrop`: compute the final target index and call `onMoveFeature`; clear
    drag state.
  - `onDragEnd`/`onDragLeave`: clear the indicator.
- A small grip handle button is rendered with the row's hover controls.

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
- a drag handle exists on a feature row.
- simulating `dragStart` on feature A then `dragOver` + `drop` on feature B
  calls `onMoveFeature` with the expected `(featureId, toIndex)`.
- dragging over a feature in another project does not call `onMoveFeature`.

# Feature Header + Unified "+" Menu (V6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a feature-header bar above the tabs (name + relay + grid + a unified "+" add-menu), make the sidebar grid icon also activate the feature, and replace the separate +/Claude/Codex buttons with one "+" menu everywhere.

**Architecture:** Two new presentational components — `AddMenuButton` (a "+" that opens a 3-item menu via the existing `ContextMenu`) and `FeatureHeader` (name + relay + grid + AddMenuButton). `TabBar` is slimmed to just the tab row; its grid/add/relay controls move into `FeatureHeader`. Grid-activate is a one-line App handler change composing existing store reducers (`setActiveFeature` + `toggleFeatureViewMode`). No new store reducers.

**Tech Stack:** React 18, TypeScript, Tailwind, Vitest + @testing-library/react. Existing `ContextMenu` component (`{ x, y, items: {label,onSelect}[], onClose }`).

---

## File Structure
- **Create:** `src/renderer/src/components/AddMenuButton.tsx` (+ test) — "+" trigger + 3-item dropdown.
- **Create:** `src/renderer/src/components/FeatureHeader.tsx` (+ test) — header bar above tabs.
- **Modify:** `src/renderer/src/components/Sidebar.tsx` (+ test) — replace 3 buttons with `AddMenuButton`.
- **Modify:** `src/renderer/src/components/TabBar.tsx` (+ test) — remove grid/add/relay cluster + props.
- **Modify:** `src/renderer/src/App.tsx` — render `FeatureHeader`, rewire `TabBar`, grid-activate.

---

## Task 1: AddMenuButton

**Files:**
- Create: `src/renderer/src/components/AddMenuButton.tsx`
- Test: `src/renderer/src/components/AddMenuButton.test.tsx`

- [ ] **Step 1: Write the failing test** — create `src/renderer/src/components/AddMenuButton.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AddMenuButton } from './AddMenuButton'

describe('AddMenuButton', () => {
  it('opens a menu with Claude/Codex/Terminal; Claude → onAdd("claude")', () => {
    const onAdd = vi.fn()
    render(<AddMenuButton onAdd={onAdd} />)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Claude' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Codex' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Terminal' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Claude' }))
    expect(onAdd).toHaveBeenCalledWith('claude')
  })

  it('Codex → onAdd("codex"), Terminal → onAdd("shell")', () => {
    const onAdd = vi.fn()
    const { rerender } = render(<AddMenuButton onAdd={onAdd} />)
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Codex' }))
    expect(onAdd).toHaveBeenCalledWith('codex')
    onAdd.mockClear()
    rerender(<AddMenuButton onAdd={onAdd} />)
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }))
    expect(onAdd).toHaveBeenCalledWith('shell')
  })

  it('uses a custom aria-label when provided', () => {
    render(<AddMenuButton onAdd={vi.fn()} label="Dodaj u auth" />)
    expect(screen.getByLabelText('Dodaj u auth')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run (should fail)**

Run: `npx vitest run src/renderer/src/components/AddMenuButton.test.tsx`
Expected: FAIL — `Cannot find module './AddMenuButton'`.

- [ ] **Step 3: Implement `src/renderer/src/components/AddMenuButton.tsx`:**

```tsx
import { useState } from 'react'
import { ContextMenu } from './ContextMenu'

export type AddKind = 'shell' | 'claude' | 'codex'

export function AddMenuButton({
  onAdd, className, title = 'Novi terminal', label = 'Dodaj terminal'
}: {
  onAdd: (kind: AddKind) => void
  className?: string
  title?: string
  label?: string
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        aria-label={label}
        title={title}
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.bottom })
        }}
        className={className}
      >
        +
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Claude', onSelect: () => onAdd('claude') },
            { label: 'Codex', onSelect: () => onAdd('codex') },
            { label: 'Terminal', onSelect: () => onAdd('shell') }
          ]}
        />
      )}
    </>
  )
}
```

- [ ] **Step 4: Run (should pass)**

Run: `npx vitest run src/renderer/src/components/AddMenuButton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AddMenuButton.tsx src/renderer/src/components/AddMenuButton.test.tsx
git commit -m "feat(ui): AddMenuButton — unified + menu (Claude/Codex/Terminal)"
```

---

## Task 2: FeatureHeader

**Files:**
- Create: `src/renderer/src/components/FeatureHeader.tsx`
- Test: `src/renderer/src/components/FeatureHeader.test.tsx`

- [ ] **Step 1: Write the failing test** — create `src/renderer/src/components/FeatureHeader.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FeatureHeader } from './FeatureHeader'

const noRelay = { canReturn: false, canReReview: false, canMarkApplied: false }
const base = {
  featureName: 'auth', viewMode: 'tabs' as const,
  onToggleView: () => {}, onAdd: () => {},
  relay: noRelay, onReturnToOrigin: () => {}, onReReview: () => {}, onMarkApplied: () => {}
}

describe('FeatureHeader', () => {
  it('shows the feature name', () => {
    render(<FeatureHeader {...base} />)
    expect(screen.getByText('auth')).toBeInTheDocument()
  })
  it('grid button calls onToggleView', () => {
    const onToggleView = vi.fn()
    render(<FeatureHeader {...base} onToggleView={onToggleView} />)
    fireEvent.click(screen.getByLabelText('Grid prikaz'))
    expect(onToggleView).toHaveBeenCalled()
  })
  it('add menu calls onAdd with the kind', () => {
    const onAdd = vi.fn()
    render(<FeatureHeader {...base} onAdd={onAdd} />)
    fireEvent.click(screen.getByLabelText('Dodaj terminal'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Codex' }))
    expect(onAdd).toHaveBeenCalledWith('codex')
  })
  it('shows relay buttons only when flagged and wires them', () => {
    const onReturnToOrigin = vi.fn()
    const { rerender } = render(<FeatureHeader {...base} />)
    expect(screen.queryByText('→ Vrati u A')).toBeNull()
    rerender(<FeatureHeader {...base} relay={{ ...noRelay, canReturn: true }} onReturnToOrigin={onReturnToOrigin} />)
    fireEvent.click(screen.getByText('→ Vrati u A'))
    expect(onReturnToOrigin).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run (should fail)**

Run: `npx vitest run src/renderer/src/components/FeatureHeader.test.tsx`
Expected: FAIL — `Cannot find module './FeatureHeader'`.

- [ ] **Step 3: Implement `src/renderer/src/components/FeatureHeader.tsx`:**

```tsx
import { GridIcon } from './icons'
import { AddMenuButton, type AddKind } from './AddMenuButton'

export function FeatureHeader({
  featureName, viewMode, onToggleView, onAdd, relay, onReturnToOrigin, onReReview, onMarkApplied
}: {
  featureName: string
  viewMode: 'tabs' | 'grid'
  onToggleView: () => void
  onAdd: (kind: AddKind) => void
  relay: { canReturn: boolean; canReReview: boolean; canMarkApplied: boolean }
  onReturnToOrigin: () => void
  onReReview: () => void
  onMarkApplied: () => void
}) {
  return (
    <div className="flex items-center gap-2 h-9 px-3 bg-panel border-b border-line">
      <span className="truncate text-sm font-medium text-fg-bright">{featureName}</span>
      <div className="ml-auto flex items-center gap-0.5 text-base leading-none">
        {relay.canReturn && (
          <button onClick={onReturnToOrigin} title="Vrati kritiku implementatoru"
            className="px-2 text-xs rounded bg-field text-accent hover:bg-hover transition">→ Vrati u A</button>
        )}
        {relay.canReReview && (
          <button onClick={onReReview} title="Pošalji ažuriran artefakt nazad revieweru"
            className="px-2 text-xs rounded bg-field text-accent hover:bg-hover transition">↻ Ponovi review</button>
        )}
        {relay.canMarkApplied && (
          <button onClick={onMarkApplied} title="Označi iteraciju gotovom"
            className="px-2 text-xs rounded bg-field text-fg-muted hover:text-fg transition">✓ Gotovo</button>
        )}
        <button
          aria-label={viewMode === 'grid' ? 'Tabs prikaz' : 'Grid prikaz'}
          aria-pressed={viewMode === 'grid'}
          title={viewMode === 'grid' ? 'Prebaci na tabove' : 'Prebaci na grid'}
          onClick={onToggleView}
          className={`px-1.5 transition-colors ${viewMode === 'grid' ? 'text-accent' : 'text-fg-muted hover:text-accent'}`}
        >
          <GridIcon />
        </button>
        <AddMenuButton onAdd={onAdd} className="px-1.5 text-sm text-fg-muted hover:text-accent transition-colors" />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run (should pass)**

Run: `npx vitest run src/renderer/src/components/FeatureHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/FeatureHeader.tsx src/renderer/src/components/FeatureHeader.test.tsx
git commit -m "feat(ui): FeatureHeader — name + relay + grid + add-menu"
```

---

## Task 3: Sidebar — unified "+" menu in feature rows

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Test: `src/renderer/src/components/Sidebar.test.tsx`

> Read the current file first. In each feature row there are currently FOUR action buttons after the feature name: a `+` (calls `onAddTerminal(f.id)`), a Claude button (`onLaunchAgent(f.id,'claude')`), a Codex button (`onLaunchAgent(f.id,'codex')`), a Grid button, and a Trash button. Replace the first THREE (`+`, Claude, Codex) with a single `AddMenuButton`. Keep Grid and Trash exactly as they are.

- [ ] **Step 1: Update Sidebar.tsx**

a) Import: add `import { AddMenuButton } from './AddMenuButton'`. After the change, `ClaudeIcon`/`CodexIcon` are no longer used in this file — remove them from the `./icons` import (keep `TerminalKindIcon`, `GridIcon`, `ReviewIcon`, `TrashIcon`, and any others still used).

b) In the feature-row action area, replace these three buttons:
```tsx
<button aria-label={`Novi terminal u ${f.name}`} title="Novi terminal" onClick={() => onAddTerminal(f.id)} className={`${hoverBtn} text-base leading-none hover:text-accent`}>+</button>
<button aria-label={`Novi Claude terminal u ${f.name}`} title="Claude" onClick={() => onLaunchAgent(f.id, 'claude')} className={`${hoverBtn} text-base leading-none`}><ClaudeIcon /></button>
<button aria-label={`Novi Codex terminal u ${f.name}`} title="Codex" onClick={() => onLaunchAgent(f.id, 'codex')} className={`${hoverBtn} text-base leading-none`}><CodexIcon /></button>
```
with a single:
```tsx
<AddMenuButton
  label={`Dodaj u ${f.name}`}
  onAdd={(kind) => (kind === 'shell' ? onAddTerminal(f.id) : onLaunchAgent(f.id, kind))}
  className={`${hoverBtn} text-base leading-none hover:text-accent`}
/>
```
Leave the Grid button (`onToggleFeatureView(f.id)`) and the Trash button untouched.

- [ ] **Step 2: Update Sidebar.test.tsx**

Read the current test. Any assertion that queries the old per-feature Claude/Codex buttons (e.g. `getByLabelText('Novi Claude terminal u ...')` / `'Novi Codex terminal u ...'` / `'Novi terminal u ...'`) must be updated, since those three buttons are replaced by one `AddMenuButton` with `aria-label={`Dodaj u ${name}`}`.
- If a test asserted launching Claude/Codex from the sidebar, rewrite it to: click `getByLabelText('Dodaj u <feature>')`, then click `getByRole('menuitem', { name: 'Claude' })` (or 'Codex'/'Terminal'), and assert `onLaunchAgent`/`onAddTerminal` was called appropriately.
- Do not weaken unrelated assertions.

- [ ] **Step 3: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: PASS. (If `ClaudeIcon`/`CodexIcon` removal left them imported-but-unused elsewhere, fix the import.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(ui): sidebar feature rows use unified AddMenuButton"
```

---

## Task 4: Integration — slim TabBar + render FeatureHeader + grid-activate

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`
- Modify: `src/renderer/src/components/TabBar.test.tsx`
- Modify: `src/renderer/src/App.tsx`

> This is one coherent change so the app keeps compiling: the props removed from `TabBar` are simultaneously moved to `FeatureHeader` in `App`. Read all three files first.

- [ ] **Step 1: Slim down `TabBar.tsx`**

Remove from the component: the entire right-side action `<div className="ml-1 self-center flex items-center gap-0.5 ...">…</div>` block (relay buttons, Grid, `+`, Claude, Codex). Remove these props from the destructure AND the prop type: `viewMode`, `onAdd`, `onLaunch`, `onToggleView`, `relay`, `onReturnToOrigin`, `onReReview`, `onMarkApplied`. Keep: `terminals`, `activeId`, `liveAgents`, `onSelect`, `onClose`, `reviewStatus`, `onReviewTerminal`. Remove now-unused imports from `./icons` (`ClaudeIcon`, `CodexIcon`, `GridIcon`) — keep `TerminalKindIcon`, `ReviewIcon`. Keep `ReviewStatusDot` import. The per-tab row (icon · status dot · name · review-hover button · ×) stays exactly as is.

Resulting component shell:
```tsx
import type { Terminal, ReviewStatus } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ReviewIcon } from './icons'
import { ReviewStatusDot } from './ReviewStatusDot'

export function TabBar({
  terminals, activeId, liveAgents, onSelect, onClose, reviewStatus, onReviewTerminal
}: {
  terminals: Terminal[]
  activeId: string | null
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  reviewStatus: Record<string, ReviewStatus | undefined>
  onReviewTerminal: (id: string, reviewer?: AgentKind) => void
}) {
  return (
    <div role="tablist" className="flex items-stretch gap-px h-9 px-2 bg-panel border-b border-line overflow-x-auto">
      {terminals.map((t) => {
        const isActive = t.id === activeId
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.id)}
            className={`group relative flex items-center gap-2 h-full px-3 text-sm cursor-pointer whitespace-nowrap transition-colors ${
              isActive ? 'bg-surface text-fg-bright' : 'text-fg-muted hover:bg-hover hover:text-fg'
            }`}
          >
            {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
            <ReviewStatusDot status={reviewStatus[t.id]} />
            <span>{t.name}</span>
            <button
              aria-label={`Review ${t.name}`}
              title="Review"
              onClick={(e) => { e.stopPropagation(); onReviewTerminal(t.id) }}
              className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-accent transition"
            >
              <ReviewIcon />
            </button>
            <button
              aria-label={`Zatvori ${t.name}`}
              title={`Sakrij (terminal nastavlja da radi; otvori ga iz sidebar-a)`}
              onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
              className="text-fg-muted hover:text-fg transition-colors"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Update `App.tsx`**

a) Imports: add `setActiveFeature` to the `./store` import; add `import { FeatureHeader } from './components/FeatureHeader'`.

b) Change the Sidebar `onToggleFeatureView` wiring to ALSO activate the feature (grid-activate):
```tsx
onToggleFeatureView={(fid) => apply((s) => toggleFeatureViewMode(setActiveFeature(s, fid), fid))}
```

c) Inside the main column `<div className="flex-1 flex flex-col min-w-0">`, render `FeatureHeader` ABOVE `<TabBar>` (only when there's an active feature):
```tsx
{activeFeature && (
  <FeatureHeader
    featureName={activeFeature.name}
    viewMode={activeFeature.viewMode ?? 'tabs'}
    onToggleView={() => apply((s) => toggleFeatureViewMode(s, activeFeature.id))}
    onAdd={(kind) => (kind === 'shell'
      ? apply((s) => addTerminal(s, activeFeature.id, { name: 'shell' }))
      : launchAgent(activeFeature.id, kind))}
    relay={relayFlags}
    onReturnToOrigin={() => { if (activeTerminal) void review.relayToOrigin(activeTerminal.id) }}
    onReReview={() => { if (activeTerminal) void review.reReview(activeTerminal.id) }}
    onMarkApplied={() => { if (activeTerminal) review.markApplied(activeTerminal.id) }}
  />
)}
```

d) Update the `<TabBar>` call: remove the now-deleted props (`viewMode`, `onAdd`, `onLaunch`, `onToggleView`, `relay`, `onReturnToOrigin`, `onReReview`, `onMarkApplied`). Keep `terminals`, `activeId`, `liveAgents`, `onSelect`, `onClose`, `reviewStatus`, `onReviewTerminal`. Resulting:
```tsx
<TabBar
  terminals={featureVisible}
  activeId={state.activeTerminalId}
  liveAgents={liveAgents}
  onSelect={(id) => apply((s) => setActiveTerminal(s, id))}
  onClose={(id) => apply((s) => hideTerminal(s, id))}
  reviewStatus={reviewStatus}
  onReviewTerminal={(id, reviewer) => setReviewReq({ id, reviewer })}
/>
```
(`activeTerminal`, `relayFlags`, `review`, `launchAgent`, `addTerminal`, `toggleFeatureViewMode`, `featureVisible` already exist in App — confirm by reading; do not redefine.)

- [ ] **Step 3: Fix `TabBar.test.tsx`**

Read the current test. Remove the now-deleted props from every `<TabBar>` render (`viewMode`, `onAdd`, `onLaunch`, `onToggleView`, `relay`, `onReturnToOrigin`, `onReReview`, `onMarkApplied`). Remove/replace any assertions that referenced the moved controls (grid toggle, `+`, Claude/Codex launch, relay buttons) — those are no longer part of `TabBar`. Keep assertions about tab rendering, selection, close, status dot, and the per-tab review button.

- [ ] **Step 4: Verify everything**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS (typecheck clean, all tests green, build succeeds).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TabBar.tsx src/renderer/src/components/TabBar.test.tsx src/renderer/src/App.tsx
git commit -m "feat(ui): feature header above tabs; slim TabBar; grid click activates feature"
```

---

## Self-Review

**Spec coverage:**
- §1 `AddMenuButton` → Task 1. ✓
- §1 `FeatureHeader` → Task 2. ✓
- §2 TabBar slim → Task 4 Step 1. ✓
- §2 Sidebar +menu → Task 3. ✓
- §2/§3 App render header + grid-activate + rewire → Task 4 Steps 2. ✓
- §3 layout (header above tabs) → Task 4 Step 2c. ✓ Relay in header → Task 2 + Task 4. ✓
- §4 testing → Task 1/2 tests + Task 3/4 test updates. ✓

**Placeholder scan:** No TBD/vague steps; every code step has full code. ✓

**Type consistency:** `AddKind = 'shell'|'claude'|'codex'` defined in Task 1, used in Task 2 (`FeatureHeader.onAdd`) and Task 4 (`App` onAdd). `relay` shape `{canReturn,canReReview,canMarkApplied}` identical across FeatureHeader and App `relayFlags`. `setActiveFeature`+`toggleFeatureViewMode` are existing store exports. TabBar slim props match the App call in Task 4 Step 2d. ✓

**Manual E2E (after Task 4):** `npm run dev` → header shows active feature name; "+" menu adds Claude/Codex/Terminal; clicking grid on a non-active sidebar feature opens it in grid; relay buttons appear in the header during a review; tab row is clean.

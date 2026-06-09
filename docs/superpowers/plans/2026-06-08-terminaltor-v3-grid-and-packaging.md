# OrchestriX V3 — Split Grid + Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) A per-group "grid" view mode that tiles all of a group's terminals at once (toggle from tabs), and (B) packaging the app into Linux AppImage + .deb.

**Architecture:** (A) `Group.viewMode` ('tabs'|'grid') drives layout. All `TerminalView`s stay mounted as a stable sibling list; switching mode only changes CSS (container becomes a CSS grid, the active group's terminals become in-flow grid cells, everyone else stays `display:none`), so no shell is ever remounted. Pure helpers (`gridColumns`/`gridDimensions`/`paneMode`) keep App thin and testable. (B) `electron-builder` config + a committed PNG icon; `node-pty` is `asarUnpack`'d so its native binding loads from the package.

**Tech Stack:** React + TypeScript, existing store/Tailwind, Vitest; electron-builder, sharp (icon rasterization, devDep only).

---

## File Structure

```
src/shared/types.ts                        # + Group.viewMode?
src/renderer/src/store.ts                  # + toggleGroupViewMode
src/renderer/src/layout.ts                 # NEW: gridColumns, gridDimensions, paneMode
src/renderer/src/components/icons.tsx      # + GridIcon
src/renderer/src/components/TabBar.tsx     # + grid/tabs toggle button
src/renderer/src/App.tsx                   # grid-aware content area + Ctrl+Shift+G
electron-builder.yml                       # NEW: packaging config
build/icon.svg                             # NEW: source icon
build/icon.png                             # NEW: rasterized 512px (committed)
scripts/make-icon.mjs                      # NEW: svg -> png
package.json                               # + author, scripts, electron-builder/sharp devDeps
```

**Backward compatibility:** `Group.viewMode` optional; v1/v2 workspaces lacking it read as `'tabs'` via `?? 'tabs'`.

---

# Part A — Split Grid

## Task A1: viewMode + toggle reducer + layout helpers

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/store.ts`
- Modify: `src/renderer/src/store.test.ts`
- Create: `src/renderer/src/layout.ts`
- Create: `src/renderer/src/layout.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/src/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gridColumns, gridDimensions, paneMode } from './layout'

describe('gridColumns', () => {
  it('uses ceil(sqrt(n)) with a floor of 1', () => {
    expect(gridColumns(0)).toBe(1)
    expect(gridColumns(1)).toBe(1)
    expect(gridColumns(2)).toBe(2)
    expect(gridColumns(3)).toBe(2)
    expect(gridColumns(4)).toBe(2)
    expect(gridColumns(5)).toBe(3)
    expect(gridColumns(9)).toBe(3)
    expect(gridColumns(10)).toBe(4)
  })
})

describe('gridDimensions', () => {
  it('returns cols and the rows needed to hold n cells', () => {
    expect(gridDimensions(1)).toEqual({ cols: 1, rows: 1 })
    expect(gridDimensions(2)).toEqual({ cols: 2, rows: 1 })
    expect(gridDimensions(3)).toEqual({ cols: 2, rows: 2 })
    expect(gridDimensions(5)).toEqual({ cols: 3, rows: 2 })
    expect(gridDimensions(9)).toEqual({ cols: 3, rows: 3 })
  })
  it('never returns zero rows', () => {
    expect(gridDimensions(0)).toEqual({ cols: 1, rows: 1 })
  })
})

describe('paneMode', () => {
  it('hides terminals outside the active group', () => {
    expect(paneMode({ inActiveGroup: false, gridMode: false })).toBe('hidden')
    expect(paneMode({ inActiveGroup: false, gridMode: true })).toBe('hidden')
  })
  it('stacks when active group is in tabs mode, grids when in grid mode', () => {
    expect(paneMode({ inActiveGroup: true, gridMode: false })).toBe('stacked')
    expect(paneMode({ inActiveGroup: true, gridMode: true })).toBe('grid')
  })
})
```

Append to `src/renderer/src/store.test.ts` (inside the `describe('store reducers', ...)` block, before its closing `})`):

```ts
  it('toggleGroupViewMode flips between tabs and grid (default tabs)', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    expect(s.workspace.groups[0].viewMode).toBeUndefined() // === tabs
    s = toggleGroupViewMode(s, gid)
    expect(s.workspace.groups[0].viewMode).toBe('grid')
    s = toggleGroupViewMode(s, gid)
    expect(s.workspace.groups[0].viewMode).toBe('tabs')
  })
```

Update the import line at the top of `store.test.ts` to include `toggleGroupViewMode`:

```ts
import {
  createInitialState, addGroup, renameGroup, toggleGroupCollapsed, toggleGroupViewMode, deleteGroup,
  addTerminal, removeTerminal, setActiveGroup, setActiveTerminal,
  getActiveGroup, getActiveTerminal, allTerminals
} from './store'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `./layout` not found; `toggleGroupViewMode` not exported.

- [ ] **Step 3: Add `viewMode` to `Group` in `src/shared/types.ts`**

Replace the `Group` interface (leave the rest unchanged):

```ts
export interface Group {
  id: string
  name: string
  collapsed: boolean
  terminals: Terminal[]
  viewMode?: 'tabs' | 'grid'   // undefined === 'tabs'
}
```

- [ ] **Step 4: Create `src/renderer/src/layout.ts`**

```ts
// Pure layout helpers for the per-group grid view.

export function gridColumns(n: number): number {
  if (n <= 1) return 1
  return Math.ceil(Math.sqrt(n))
}

export function gridDimensions(n: number): { cols: number; rows: number } {
  const cols = gridColumns(n)
  const rows = Math.max(1, Math.ceil(n / cols))
  return { cols, rows }
}

export type PaneMode = 'hidden' | 'stacked' | 'grid'

export function paneMode(opts: { inActiveGroup: boolean; gridMode: boolean }): PaneMode {
  if (!opts.inActiveGroup) return 'hidden'
  return opts.gridMode ? 'grid' : 'stacked'
}
```

- [ ] **Step 5: Add `toggleGroupViewMode` to `src/renderer/src/store.ts`**

Add this function right after the existing `toggleGroupCollapsed` function:

```ts
export function toggleGroupViewMode(state: AppState, groupId: string): AppState {
  return {
    ...state,
    workspace: {
      groups: state.workspace.groups.map(g =>
        g.id === groupId
          ? { ...g, viewMode: (g.viewMode ?? 'tabs') === 'tabs' ? 'grid' : 'tabs' }
          : g)
    }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all prior + layout + store viewMode tests).

- [ ] **Step 7: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: group viewMode + toggle reducer + grid layout helpers"
```
(End every commit message in this plan with a blank line then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task A2: GridIcon

**Files:**
- Modify: `src/renderer/src/components/icons.tsx`
- Modify: `src/renderer/src/components/icons.test.tsx`

- [ ] **Step 1: Add a failing test**

Append inside the existing `describe('TerminalKindIcon', ...)` block's file (add a new `describe` after it) in `icons.test.tsx`:

```tsx
import { GridIcon } from './icons'

describe('GridIcon', () => {
  it('renders a grid glyph', () => {
    render(<GridIcon />)
    expect(screen.getByTestId('icon-grid')).toBeInTheDocument()
  })
})
```

(Keep the existing imports; just add `GridIcon` to the import from `./icons` and the new `describe`. The `render`/`screen` imports already exist at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `GridIcon` not exported.

- [ ] **Step 3: Add `GridIcon` to `src/renderer/src/components/icons.tsx`**

Add this export (e.g. after `ShellIcon`):

```tsx
export function GridIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-grid" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: GridIcon"
```

---

## Task A3: TabBar grid/tabs toggle (+ wire prop in App)

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`
- Modify: `src/renderer/src/components/TabBar.test.tsx`
- Modify: `src/renderer/src/App.tsx`

The toggle button needs `viewMode` + `onToggleView` props. Because App already renders `TabBar`, App must pass them in the SAME task to keep `tsc` green (the grid *rendering* itself comes in A4 — here the content area is still tabs-only).

- [ ] **Step 1: Add tests to `src/renderer/src/components/TabBar.test.tsx`**

Add `onToggleView` to the props of EVERY existing `render(<TabBar ... />)` call (add `onToggleView={noop}` and `viewMode="tabs"` to each). Then append these two tests inside the `describe('TabBar', ...)` block:

```tsx
  it('toggles the view when the grid button is clicked', async () => {
    const onToggleView = vi.fn()
    render(<TabBar terminals={terms} activeId="a" viewMode="tabs" onToggleView={onToggleView}
      onSelect={noop} onClose={noop} onAdd={noop} onLaunch={noop} />)
    await userEvent.click(screen.getByLabelText('Grid prikaz'))
    expect(onToggleView).toHaveBeenCalled()
  })

  it('labels the toggle for switching back when already in grid', () => {
    render(<TabBar terminals={terms} activeId="a" viewMode="grid" onToggleView={noop}
      onSelect={noop} onClose={noop} onAdd={noop} onLaunch={noop} />)
    expect(screen.getByLabelText('Tabs prikaz')).toBeInTheDocument()
  })
```

For reference, the first existing test should now read:

```tsx
  it('renders a tab per terminal and marks the active one', () => {
    render(<TabBar terminals={terms} activeId="a" viewMode="tabs" onToggleView={noop}
      onSelect={noop} onClose={noop} onAdd={noop} onLaunch={noop} />)
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.getByText('tests')).toBeInTheDocument()
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('claude-api')
  })
```

Apply the same `viewMode="tabs" onToggleView={noop}` addition to the other existing render calls (`onSelect`, `onClose`, `onAdd`, `onLaunch`, and the kind-icon tests).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `viewMode`/`onToggleView` not props; grid button missing.

- [ ] **Step 3: Update `src/renderer/src/components/TabBar.tsx`**

Add `GridIcon` to the icons import, add the two props, and add the toggle button as the FIRST child of the right-hand toolbar `div` (before the `+` button). The new file:

```tsx
// src/renderer/src/components/TabBar.tsx
import type { Terminal } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ClaudeIcon, CodexIcon, GridIcon } from './icons'

export function TabBar({
  terminals, activeId, viewMode, onSelect, onClose, onAdd, onLaunch, onToggleView
}: {
  terminals: Terminal[]
  activeId: string | null
  viewMode: 'tabs' | 'grid'
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  onLaunch: (kind: AgentKind) => void
  onToggleView: () => void
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
            <TerminalKindIcon kind={t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
            <span>{t.name}</span>
            <button
              aria-label={`Zatvori ${t.name}`}
              onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
              className="text-fg-muted hover:text-danger transition-colors"
            >
              ×
            </button>
          </div>
        )
      })}
      <div className="ml-1 self-center flex items-center gap-0.5 text-base leading-none">
        <button
          aria-label={viewMode === 'grid' ? 'Tabs prikaz' : 'Grid prikaz'}
          aria-pressed={viewMode === 'grid'}
          title={viewMode === 'grid' ? 'Prebaci na tabove' : 'Prebaci na grid'}
          onClick={onToggleView}
          className={`px-1.5 transition-colors ${viewMode === 'grid' ? 'text-accent' : 'text-fg-muted hover:text-accent'}`}
        >
          <GridIcon />
        </button>
        <button
          aria-label="Novi terminal"
          onClick={onAdd}
          className="px-1.5 text-sm text-fg-muted hover:text-accent transition-colors"
        >
          +
        </button>
        <button
          aria-label="Novi Claude terminal"
          title="Novi Claude terminal"
          onClick={() => onLaunch('claude')}
          className="px-1 opacity-80 hover:opacity-100 transition-opacity"
        >
          <ClaudeIcon />
        </button>
        <button
          aria-label="Novi Codex terminal"
          title="Novi Codex terminal"
          onClick={() => onLaunch('codex')}
          className="px-1 opacity-80 hover:opacity-100 transition-opacity"
        >
          <CodexIcon />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire the new props in `src/renderer/src/App.tsx`**

(a) Add `toggleGroupViewMode` to the `./store` import (insert after `toggleGroupCollapsed`):

```ts
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed, toggleGroupViewMode,
  addTerminal, removeTerminal, setActiveTerminal,
  getActiveGroup, allTerminals
```

(b) In the `<TabBar ... />` JSX, add `viewMode` and `onToggleView` (after the existing `onLaunch` line):

```tsx
          onLaunch={(kind) => { if (state.activeGroupId) launchAgent(state.activeGroupId, kind) }}
          viewMode={activeGroup?.viewMode ?? 'tabs'}
          onToggleView={() => { if (activeGroup) apply((s) => toggleGroupViewMode(s, activeGroup.id)) }}
```

- [ ] **Step 5: Run tests, typecheck, build**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: clean.
Run: `npm run build` — Expected: compiles.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: TabBar grid/tabs toggle button, wired in App"
```

---

## Task A4: App grid layout + Ctrl+Shift+G

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Import the layout helper**

Add to App.tsx imports (after the `./agents` import):

```tsx
import { gridDimensions } from './layout'
```

- [ ] **Step 2: Add a `Ctrl+Shift+G` branch to the keyboard handler**

Inside the `onKey` function in the keyboard-shortcuts `useEffect`, add this branch (e.g. after the `KeyW` branch, before the `PageDown` branch):

```tsx
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyG') { // toggle grid/tabs for active group
        e.preventDefault()
        if (state.activeGroupId) apply((s) => toggleGroupViewMode(s, state.activeGroupId!))
```

- [ ] **Step 3: Replace the content-area block in `App.tsx`**

Replace this current block:

```tsx
        <div className="relative flex-1 bg-surface">
          {terminals.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg-muted">
              <span className="text-2xl font-semibold tracking-tight text-fg">OrchestriX</span>
              <span className="text-sm">Napravi grupu pa terminal da počneš.</span>
            </div>
          )}
          {/* All terminals stay mounted so their shells keep running while hidden. */}
          {terminals.map((t) => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ display: t.id === state.activeTerminalId ? 'block' : 'none' }}
            >
              <TerminalView terminal={t} active={t.id === state.activeTerminalId} />
            </div>
          ))}
        </div>
```

with:

```tsx
        {(() => {
          const gridMode = (activeGroup?.viewMode ?? 'tabs') === 'grid'
          const groupTerminalIds = new Set((activeGroup?.terminals ?? []).map((t) => t.id))
          const { cols, rows } = gridDimensions(groupTerminalIds.size)
          return (
            <div
              className={`relative flex-1 min-h-0 bg-surface ${gridMode ? 'grid gap-px bg-line' : ''}`}
              style={gridMode ? {
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
              } : undefined}
            >
              {terminals.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg-muted">
                  <span className="text-2xl font-semibold tracking-tight text-fg">OrchestriX</span>
                  <span className="text-sm">Napravi grupu pa terminal da počneš.</span>
                </div>
              )}
              {/* All terminals stay mounted (stable siblings) so shells survive view switches. */}
              {terminals.map((t) => {
                const inActive = groupTerminalIds.has(t.id)
                const isActive = t.id === state.activeTerminalId
                if (gridMode && inActive) {
                  return (
                    <div
                      key={t.id}
                      onMouseDown={() => apply((s) => setActiveTerminal(s, t.id))}
                      className={`relative min-h-0 min-w-0 bg-surface border ${isActive ? 'border-accent' : 'border-transparent'}`}
                    >
                      <TerminalView terminal={t} active={isActive} />
                    </div>
                  )
                }
                const visible = inActive && !gridMode && isActive
                return (
                  <div
                    key={t.id}
                    className="absolute inset-0"
                    style={{ display: visible ? 'block' : 'none' }}
                  >
                    <TerminalView terminal={t} active={isActive} />
                  </div>
                )
              })}
            </div>
          )
        })()}
```

> Why this preserves shells: every terminal is still one `div` keyed by `t.id` at the same position in the `terminals.map` array. React reconciles by (type=`div`, key), so flipping a wrapper between "grid cell" and "absolute" only updates its className/handlers — the child `TerminalView` is never unmounted, so the PTY keeps running. The existing `ResizeObserver` in `TerminalView` refits xterm when a cell goes from `display:none` (0px) to a real size.

- [ ] **Step 4: Type-check, test, build**

Run: `npm run typecheck` — Expected: clean.
Run: `npm test` — Expected: PASS.
Run: `npm run build` — Expected: compiles.

- [ ] **Step 5: Manual E2E (human step — note for the controller)**

`npm run dev`, then:
- A group with 2+ terminals: click the grid button (or `Ctrl+Shift+G`) → all terminals tile evenly and stay live; the focused one has an accent border; clicking another pane focuses it.
- Start a long process in one pane, toggle back to tabs and to grid again → process still running (no remount).
- Resize the window in grid → panes reflow and xterm refits.
- Switch to another group → its own viewMode applies; first group's shells keep running.
- Quit + relaunch → each group restores its viewMode.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: per-group grid layout + Ctrl+Shift+G toggle"
```

---

# Part B — Packaging (AppImage + .deb)

## Task B1: electron-builder config + scripts

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json`

- [ ] **Step 1: Create `electron-builder.yml`**

```yaml
appId: com.orchestrix.app
productName: OrchestriX
directories:
  output: release
  buildResources: build
files:
  - out/**/*
  - package.json
asarUnpack:
  - "**/node_modules/node-pty/**"
linux:
  target:
    - AppImage
    - deb
  category: Development
  maintainer: Miljan Garovic <markogarovic1998@gmail.com>
  synopsis: Grupisani imenovani terminali za Linux
  description: Desktop wrapper nad terminalom — imenovani terminali grupisani u cjeline.
```

- [ ] **Step 2: Update `package.json`**

Set the `author` field (electron-builder requires it for the .deb) and add scripts + devDeps. Change `"author": ""` to:

```json
  "author": "Miljan Garovic <markogarovic1998@gmail.com>",
```

Add these entries to the `"scripts"` object:

```json
    "icon": "node scripts/make-icon.mjs",
    "package": "electron-vite build && electron-builder --linux AppImage deb",
```

Add these to `"devDependencies"`:

```json
    "electron-builder": "^24.13.3",
    "sharp": "^0.33.5",
```

- [ ] **Step 3: Install the new devDeps**

Run: `npm install`
Expected: installs electron-builder and sharp (sharp ships prebuilt binaries; no native compile expected).

- [ ] **Step 4: Verify the renderer/main still build**

Run: `npm run build`
Expected: `electron-vite build` compiles all three bundles (this is the input electron-builder will package).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: electron-builder config + package scripts"
```

---

## Task B2: App icon (svg → png)

**Files:**
- Create: `build/icon.svg`
- Create: `scripts/make-icon.mjs`
- Create (generated, committed): `build/icon.png`

- [ ] **Step 1: Create `build/icon.svg`** (One Dark mark: dark rounded square + accent prompt)

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#21252b"/>
  <rect x="40" y="40" width="432" height="432" rx="80" fill="#282c34"/>
  <g fill="none" stroke="#61afef" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M150 190 L228 256 L150 322"/>
    <path d="M280 330 H372"/>
  </g>
</svg>
```

- [ ] **Step 2: Create `scripts/make-icon.mjs`** (rasterize with sharp)

```js
import sharp from 'sharp'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build/icon.svg'))

await sharp(svg, { density: 384 })
  .resize(512, 512)
  .png()
  .toFile(join(root, 'build/icon.png'))

console.log('Wrote build/icon.png (512x512)')
```

- [ ] **Step 3: Generate the PNG**

Run: `npm run icon`
Expected: prints "Wrote build/icon.png (512x512)". Confirm the file exists and is a 512×512 PNG:
Run: `file build/icon.png`
Expected: `PNG image data, 512 x 512`.

If `sharp` failed to load for any reason, report it (do NOT fake the PNG) — the controller will decide a fallback (e.g. `rsvg-convert build/icon.svg -w 512 -h 512 -o build/icon.png` or ImageMagick `convert -density 384 -background none build/icon.svg -resize 512x512 build/icon.png`).

- [ ] **Step 4: Commit the source AND the generated PNG**

```bash
git add -A
git commit -m "build: app icon (svg + rasterized png)"
```

---

## Task B3: Build the packages

**Files:** none (runs the pipeline)

This is the heavy step: electron-builder downloads its toolchain + an Electron build and emits large artifacts. It runs headless (no GUI needed).

- [ ] **Step 1: Rebuild node-pty for the Electron ABI (safety)**

Run: `npm run rebuild`
Expected: node-pty rebuilds for Electron (already done earlier, but re-confirm before packaging).

- [ ] **Step 2: Run the packager**

Run: `npm run package`
Expected: `electron-vite build` then `electron-builder` produce, under `release/`:
- `OrchestriX-0.1.0.AppImage` (name may vary by version)
- `orchestrix_0.1.0_amd64.deb`

- [ ] **Step 3: Verify the artifacts exist**

Run: `ls -lh release/*.AppImage release/*.deb`
Expected: both files present, tens of MB each.

- [ ] **Step 4: Confirm `release/` is git-ignored**

`.gitignore` already lists `dist/` and `out/`; add `release/` if not present:

Run: `grep -q '^release/' .gitignore || printf 'release/\n' >> .gitignore`
Then:

```bash
git add .gitignore
git commit -m "build: ignore release/ artifacts"
```

(Do NOT commit the binary artifacts.)

- [ ] **Step 5: Document packaging in `README.md`**

Add this section after the existing "## Razvoj" section:

```markdown
## Pakovanje (Linux)

```bash
npm run icon      # (jednom) generiše build/icon.png iz build/icon.svg
npm run package   # pravi AppImage + .deb u release/
```
```

Commit:

```bash
git add README.md
git commit -m "docs: packaging instructions"
```

---

## Self-Review Notes (author)

**Spec coverage:**
- A) viewMode + toggle reducer → A1; layout helpers (gridColumns/gridDimensions/paneMode) → A1; GridIcon → A2; TabBar toggle (+ App prop) → A3; App grid rendering + Ctrl+Shift+G + persistence (viewMode on Group) → A4. "Shells survive view switch" addressed by the stable-sibling reconciliation note in A4.
- B) electron-builder config + AppImage/deb targets → B1; asarUnpack node-pty → B1; icon svg+png → B2; package script + final build + .gitignore + docs → B1/B3.

**Type consistency:** `Group.viewMode?: 'tabs'|'grid'` (A1) consumed by `toggleGroupViewMode` (A1), TabBar `viewMode` prop (A3), App (A3/A4). `gridDimensions`/`gridColumns`/`paneMode` defined in layout.ts (A1); App uses `gridDimensions` (A4). `GridIcon` defined A2, used A3. `onToggleView` prop name consistent between TabBar (A3 def + test) and App (A3 call site).

**Inter-task typecheck:** A3 makes `viewMode`/`onToggleView` required on TabBar AND updates App to pass them in the same task — `tsc` stays green between tasks. A4 only adds rendering; it doesn't change signatures.

**Placeholder scan:** no TBD/TODO; all code blocks complete; B2 has an explicit non-faking fallback note.

**Out of scope:** manual tmux-style binary splits, drag-resize, pane subset selection (A); auto-update, code signing, Windows/macOS, Flatpak/snap (B).
```

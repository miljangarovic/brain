# OrchestriX V4a — Features Hierarchy Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a 3-level hierarchy (Group → Feature → Terminal) with a per-group working directory that terminals inherit, modal group creation, inline feature/terminal creation, inline rename at every level, the group cwd shown in the sidebar, and tabs/grid scoped to the active feature.

**Architecture:** A model change (`Group.cwd` + `Group.features`, new `Feature` entity, `viewMode` moves from group to feature) plus a `migrateWorkspace` upgrader for old saves. Pure store reducers/selectors carry an added `activeFeatureId`. The renderer (Sidebar/App) is rewritten for three levels; `TabBar` is unchanged (App feeds it the active feature's terminals). `NewTerminalDialog` is replaced by `NewGroupDialog`.

**Tech Stack:** React + TypeScript, existing Vitest + Testing Library. No new deps.

> **BUILD-RED NOTE:** Changing `Group.terminals` → `Group.features` (Task 1) makes the not-yet-migrated components fail `tsc`. For Tasks 1–2 verify with `npm test` only. `npm run typecheck` and `npm run build` are expected to be RED from Task 1 until Task 5 (App rewrite) brings them GREEN again. Each task's tests still pass.

---

## File Structure

```
src/shared/types.ts                              # Group.cwd+features, Feature, Terminal (unchanged fields)
src/renderer/src/migrate.ts                      # NEW: migrateWorkspace(raw) -> Workspace
src/renderer/src/store.ts                        # rewrite: features-aware reducers + activeFeatureId
src/renderer/src/components/Sidebar.tsx          # rewrite: 3-level tree, cwd, inline rename, inline add
src/renderer/src/components/NewGroupDialog.tsx   # NEW: name + cwd (replaces NewTerminalDialog)
src/renderer/src/components/NewTerminalDialog.*  # DELETE
src/renderer/src/App.tsx                         # rewrite: active feature, grid per feature, wiring
```

---

## Task 1: Model + migration

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/renderer/src/migrate.ts`
- Create: `src/renderer/src/migrate.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/src/migrate.test.ts
import { describe, it, expect } from 'vitest'
import { migrateWorkspace } from './migrate'

describe('migrateWorkspace', () => {
  it('wraps an old group.terminals into a default "general" feature', () => {
    const old = { groups: [{ id: 'g', name: 'G', collapsed: false, terminals: [{ id: 't', name: 'x', cwd: '' }] }] }
    const ws = migrateWorkspace(old)
    const g = ws.groups[0]
    expect(g.cwd).toBe('')
    expect(g.features).toHaveLength(1)
    expect(g.features[0].name).toBe('general')
    expect(g.features[0].terminals[0].id).toBe('t')
    expect('terminals' in g).toBe(false)
  })

  it('moves an old group.viewMode onto the default feature', () => {
    const old = { groups: [{ id: 'g', name: 'G', collapsed: false, viewMode: 'grid', terminals: [] }] }
    const ws = migrateWorkspace(old)
    expect(ws.groups[0].features[0].viewMode).toBe('grid')
  })

  it('keeps a new-shape group unchanged (idempotent)', () => {
    const cur = { groups: [{ id: 'g', name: 'G', cwd: '/tmp', collapsed: false, features: [
      { id: 'f', name: 'feat', collapsed: false, terminals: [] }
    ] }] }
    const ws = migrateWorkspace(cur)
    expect(ws.groups[0].cwd).toBe('/tmp')
    expect(ws.groups[0].features[0].id).toBe('f')
  })

  it('returns an empty workspace for missing/garbage input', () => {
    expect(migrateWorkspace(null)).toEqual({ groups: [] })
    expect(migrateWorkspace({})).toEqual({ groups: [] })
    expect(migrateWorkspace({ groups: 'nope' })).toEqual({ groups: [] })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `./migrate` not found.

- [ ] **Step 3: Update `src/shared/types.ts`**

Replace the `Group` interface and add `Feature` (keep `Terminal`, `TerminalKind`, `Workspace`, `createWorkspace`):

```ts
export interface Feature {
  id: string
  name: string
  collapsed: boolean
  viewMode?: 'tabs' | 'grid'   // undefined === 'tabs'
  terminals: Terminal[]
}

export interface Group {
  id: string
  name: string
  cwd: string                  // '' === home (~)
  collapsed: boolean
  features: Feature[]
}
```

(Remove the old `Group` with `terminals`/`viewMode`. Leave `Terminal` exactly as-is.)

- [ ] **Step 4: Create `src/renderer/src/migrate.ts`**

```ts
import { Workspace, Group, Feature, Terminal } from '@shared/types'
import { createId } from '@shared/id'

// Upgrades a parsed-from-disk workspace to the current shape. Old saves stored
// terminals directly on a group (`group.terminals` + optional `group.viewMode`);
// those become a single default "general" feature. New saves pass through.
export function migrateWorkspace(raw: unknown): Workspace {
  const r = raw as { groups?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.groups)) return { groups: [] }

  const groups = r.groups.map((gv): Group => {
    const g = gv as Record<string, unknown>
    const cwd = typeof g.cwd === 'string' ? g.cwd : ''
    const collapsed = !!g.collapsed
    if (Array.isArray(g.features)) {
      return { id: g.id as string, name: g.name as string, cwd, collapsed, features: g.features as Feature[] }
    }
    const terminals = (Array.isArray(g.terminals) ? g.terminals : []) as Terminal[]
    const feature: Feature = {
      id: createId(),
      name: 'general',
      collapsed: false,
      viewMode: g.viewMode as ('tabs' | 'grid' | undefined),
      terminals
    }
    return { id: g.id as string, name: g.name as string, cwd, collapsed, features: [feature] }
  })
  return { groups }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (migrate tests). NOTE: other test files that build the OLD group shape (store.test, Sidebar.test, TabBar.test) will now FAIL to compile/run — that is expected and fixed in Tasks 2–5. Confirm specifically that `migrate.test.ts` passes:
Run: `npx vitest run src/renderer/src/migrate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/src/migrate.ts src/renderer/src/migrate.test.ts
git commit -m "feat: Feature entity + group cwd + migrateWorkspace"
```
(End every commit message in this plan with a blank line then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: Store — features-aware reducers + activeFeatureId

**Files:**
- Modify (rewrite): `src/renderer/src/store.ts`
- Modify (rewrite): `src/renderer/src/store.test.ts`

- [ ] **Step 1: Replace `src/renderer/src/store.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode,
  addTerminal, renameTerminal, removeTerminal,
  setActiveGroup, setActiveFeature, setActiveTerminal,
  getActiveGroup, getActiveFeature, getActiveTerminal, allTerminals
} from './store'
import { migrateWorkspace } from './migrate'

const firstGroup = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0]
const firstFeature = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0].features[0]

describe('store reducers', () => {
  it('addGroup creates a group with cwd + a default "general" feature, both active', () => {
    const s = addGroup(createInitialState(), 'proj', '/home/me/proj')
    const g = firstGroup(s)
    expect(g.name).toBe('proj')
    expect(g.cwd).toBe('/home/me/proj')
    expect(g.features).toHaveLength(1)
    expect(g.features[0].name).toBe('general')
    expect(s.activeGroupId).toBe(g.id)
    expect(s.activeFeatureId).toBe(g.features[0].id)
    expect(s.activeTerminalId).toBeNull()
  })

  it('renameGroup / toggleGroupCollapsed', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = renameGroup(s, gid, 'b')
    expect(firstGroup(s).name).toBe('b')
    s = toggleGroupCollapsed(s, gid)
    expect(firstGroup(s).collapsed).toBe(true)
  })

  it('addFeature appends a feature and activates it', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'auth')
    expect(firstGroup(s).features).toHaveLength(2)
    const auth = firstGroup(s).features[1]
    expect(auth.name).toBe('auth')
    expect(s.activeFeatureId).toBe(auth.id)
    expect(s.activeTerminalId).toBeNull()
  })

  it('renameFeature / toggleFeatureCollapsed / toggleFeatureViewMode', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = renameFeature(s, fid, 'core')
    expect(firstFeature(s).name).toBe('core')
    s = toggleFeatureCollapsed(s, fid)
    expect(firstFeature(s).collapsed).toBe(true)
    expect(firstFeature(s).viewMode).toBeUndefined()
    s = toggleFeatureViewMode(s, fid)
    expect(firstFeature(s).viewMode).toBe('grid')
    s = toggleFeatureViewMode(s, fid)
    expect(firstFeature(s).viewMode).toBe('tabs')
  })

  it('addTerminal puts the terminal in the feature and inherits the group cwd', () => {
    let s = addGroup(createInitialState(), 'a', '/proj')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'claude', startupCommand: 'claude', kind: 'claude' })
    const t = firstFeature(s).terminals[0]
    expect(t.name).toBe('claude')
    expect(t.cwd).toBe('/proj')   // inherited
    expect(t.kind).toBe('claude')
    expect(s.activeTerminalId).toBe(t.id)
  })

  it('renameTerminal', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    const tid = firstFeature(s).terminals[0].id
    s = renameTerminal(s, tid, 'y')
    expect(firstFeature(s).terminals[0].name).toBe('y')
  })

  it('removeTerminal selects a sibling within the feature', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    const aId = firstFeature(s).terminals[0].id
    const bId = firstFeature(s).terminals[1].id
    s = setActiveTerminal(s, bId)
    s = removeTerminal(s, bId)
    expect(firstFeature(s).terminals).toHaveLength(1)
    expect(s.activeTerminalId).toBe(aId)
  })

  it('deleteFeature re-selects another feature in the group', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'second')
    const f1 = firstGroup(s).features[0].id
    const f2 = firstGroup(s).features[1].id
    s = setActiveFeature(s, f2)
    s = deleteFeature(s, f2)
    expect(firstGroup(s).features).toHaveLength(1)
    expect(s.activeFeatureId).toBe(f1)
  })

  it('deleteGroup re-selects another group', () => {
    let s = addGroup(addGroup(createInitialState(), 'g1', ''), 'g2', '')
    const g1 = s.workspace.groups[0].id
    const g2 = s.workspace.groups[1].id
    s = deleteGroup(s, g2)
    expect(s.workspace.groups).toHaveLength(1)
    expect(s.activeGroupId).toBe(g1)
  })

  it('setActiveTerminal sets the owning feature and group too', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'f2')
    const f1 = firstGroup(s).features[0].id
    s = addTerminal(s, f1, { name: 't' })
    const tid = firstGroup(s).features[0].terminals[0].id
    s = setActiveFeature(s, firstGroup(s).features[1].id) // make f2 active
    s = setActiveTerminal(s, tid)
    expect(s.activeFeatureId).toBe(f1)
    expect(s.activeGroupId).toBe(gid)
    expect(s.activeTerminalId).toBe(tid)
  })

  it('selectors + allTerminals', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    expect(getActiveGroup(s)?.name).toBe('a')
    expect(getActiveFeature(s)?.id).toBe(fid)
    expect(getActiveTerminal(s)?.name).toBe('x')
    expect(allTerminals(s)).toHaveLength(1)
  })

  it('createInitialState picks first group/feature/terminal from a migrated workspace', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'G', collapsed: false, terminals: [{ id: 't', name: 'x', cwd: '' }] }] })
    const s = createInitialState(ws)
    expect(s.activeGroupId).toBe('g')
    expect(s.activeFeatureId).toBe(ws.groups[0].features[0].id)
    expect(s.activeTerminalId).toBe('t')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: FAIL — store exports don't match yet.

- [ ] **Step 3: Replace `src/renderer/src/store.ts`**

```ts
import { Workspace, Group, Feature, Terminal, TerminalKind, createWorkspace } from '@shared/types'
import { createId } from '@shared/id'

export interface AppState {
  workspace: Workspace
  activeGroupId: string | null
  activeFeatureId: string | null
  activeTerminalId: string | null
}

// ---- helpers -------------------------------------------------------------
const mapGroups = (ws: Workspace, fn: (g: Group) => Group): Workspace => ({ groups: ws.groups.map(fn) })

const mapGroup = (ws: Workspace, groupId: string, fn: (g: Group) => Group): Workspace =>
  mapGroups(ws, (g) => (g.id === groupId ? fn(g) : g))

const mapFeature = (ws: Workspace, featureId: string, fn: (f: Feature) => Feature): Workspace =>
  mapGroups(ws, (g) => ({ ...g, features: g.features.map((f) => (f.id === featureId ? fn(f) : f)) }))

const groupOfFeature = (ws: Workspace, featureId: string): Group | undefined =>
  ws.groups.find((g) => g.features.some((f) => f.id === featureId))

const featureOfTerminal = (ws: Workspace, terminalId: string): { group: Group; feature: Feature } | undefined => {
  for (const g of ws.groups) for (const f of g.features) if (f.terminals.some((t) => t.id === terminalId)) return { group: g, feature: f }
  return undefined
}

const selectFeature = (g: Group | null): { featureId: string | null; terminalId: string | null } => {
  const f = g?.features[0] ?? null
  return { featureId: f?.id ?? null, terminalId: f?.terminals[0]?.id ?? null }
}

// ---- init ----------------------------------------------------------------
export function createInitialState(ws: Workspace = createWorkspace()): AppState {
  const g = ws.groups[0] ?? null
  const sel = selectFeature(g)
  return { workspace: ws, activeGroupId: g?.id ?? null, activeFeatureId: sel.featureId, activeTerminalId: sel.terminalId }
}

// ---- groups --------------------------------------------------------------
export function addGroup(state: AppState, name: string, cwd: string): AppState {
  const feature: Feature = { id: createId(), name: 'general', collapsed: false, terminals: [] }
  const group: Group = { id: createId(), name, cwd, collapsed: false, features: [feature] }
  return {
    ...state,
    workspace: { groups: [...state.workspace.groups, group] },
    activeGroupId: group.id,
    activeFeatureId: feature.id,
    activeTerminalId: null
  }
}

export function renameGroup(state: AppState, groupId: string, name: string): AppState {
  return { ...state, workspace: mapGroup(state.workspace, groupId, (g) => ({ ...g, name })) }
}

export function toggleGroupCollapsed(state: AppState, groupId: string): AppState {
  return { ...state, workspace: mapGroup(state.workspace, groupId, (g) => ({ ...g, collapsed: !g.collapsed })) }
}

export function deleteGroup(state: AppState, groupId: string): AppState {
  const groups = state.workspace.groups.filter((g) => g.id !== groupId)
  let { activeGroupId, activeFeatureId, activeTerminalId } = state
  if (activeGroupId === groupId) {
    const ng = groups[0] ?? null
    const sel = selectFeature(ng)
    activeGroupId = ng?.id ?? null
    activeFeatureId = sel.featureId
    activeTerminalId = sel.terminalId
  }
  return { ...state, workspace: { groups }, activeGroupId, activeFeatureId, activeTerminalId }
}

// ---- features ------------------------------------------------------------
export function addFeature(state: AppState, groupId: string, name: string): AppState {
  const feature: Feature = { id: createId(), name, collapsed: false, terminals: [] }
  return {
    ...state,
    workspace: mapGroup(state.workspace, groupId, (g) => ({ ...g, collapsed: false, features: [...g.features, feature] })),
    activeGroupId: groupId,
    activeFeatureId: feature.id,
    activeTerminalId: null
  }
}

export function renameFeature(state: AppState, featureId: string, name: string): AppState {
  return { ...state, workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, name })) }
}

export function toggleFeatureCollapsed(state: AppState, featureId: string): AppState {
  return { ...state, workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, collapsed: !f.collapsed })) }
}

export function toggleFeatureViewMode(state: AppState, featureId: string): AppState {
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, viewMode: (f.viewMode ?? 'tabs') === 'tabs' ? 'grid' : 'tabs' }))
  }
}

export function deleteFeature(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const ws = group
    ? mapGroup(state.workspace, group.id, (g) => ({ ...g, features: g.features.filter((f) => f.id !== featureId) }))
    : state.workspace
  let { activeFeatureId, activeTerminalId } = state
  if (activeFeatureId === featureId) {
    const g2 = ws.groups.find((g) => g.id === group?.id) ?? null
    const sel = selectFeature(g2)
    activeFeatureId = sel.featureId
    activeTerminalId = sel.terminalId
  }
  return { ...state, workspace: ws, activeFeatureId, activeTerminalId }
}

// ---- terminals -----------------------------------------------------------
export function addTerminal(
  state: AppState,
  featureId: string,
  input: { name: string; startupCommand?: string; kind?: TerminalKind }
): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const startupCommand = input.startupCommand?.trim()
  const term: Terminal = {
    id: createId(),
    name: input.name,
    cwd: group?.cwd ?? '',
    startupCommand: startupCommand || undefined,
    kind: input.kind && input.kind !== 'shell' ? input.kind : undefined
  }
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, collapsed: false, terminals: [...f.terminals, term] })),
    activeGroupId: group?.id ?? state.activeGroupId,
    activeFeatureId: featureId,
    activeTerminalId: term.id
  }
}

export function renameTerminal(state: AppState, terminalId: string, name: string): AppState {
  return {
    ...state,
    workspace: mapGroups(state.workspace, (g) => ({
      ...g,
      features: g.features.map((f) => ({ ...f, terminals: f.terminals.map((t) => (t.id === terminalId ? { ...t, name } : t)) }))
    }))
  }
}

export function removeTerminal(state: AppState, terminalId: string): AppState {
  let activeTerminalId = state.activeTerminalId
  const workspace = mapGroups(state.workspace, (g) => ({
    ...g,
    features: g.features.map((f) => {
      const idx = f.terminals.findIndex((t) => t.id === terminalId)
      if (idx === -1) return f
      const terminals = f.terminals.filter((t) => t.id !== terminalId)
      if (activeTerminalId === terminalId) {
        const next = terminals[idx] ?? terminals[idx - 1] ?? null
        activeTerminalId = next?.id ?? null
      }
      return { ...f, terminals }
    })
  }))
  return { ...state, workspace, activeTerminalId }
}

// ---- active selection ----------------------------------------------------
export function setActiveGroup(state: AppState, groupId: string): AppState {
  const g = state.workspace.groups.find((x) => x.id === groupId) ?? null
  const sel = selectFeature(g)
  return { ...state, activeGroupId: groupId, activeFeatureId: sel.featureId, activeTerminalId: sel.terminalId }
}

export function setActiveFeature(state: AppState, featureId: string): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const feature = group?.features.find((f) => f.id === featureId) ?? null
  return {
    ...state,
    activeGroupId: group?.id ?? state.activeGroupId,
    activeFeatureId: featureId,
    activeTerminalId: feature?.terminals[0]?.id ?? null
  }
}

export function setActiveTerminal(state: AppState, terminalId: string): AppState {
  const loc = featureOfTerminal(state.workspace, terminalId)
  return {
    ...state,
    activeGroupId: loc?.group.id ?? state.activeGroupId,
    activeFeatureId: loc?.feature.id ?? state.activeFeatureId,
    activeTerminalId: terminalId
  }
}

// ---- selectors -----------------------------------------------------------
export const getActiveGroup = (s: AppState): Group | null =>
  s.workspace.groups.find((g) => g.id === s.activeGroupId) ?? null

export const getActiveFeature = (s: AppState): Feature | null => {
  for (const g of s.workspace.groups) { const f = g.features.find((f) => f.id === s.activeFeatureId); if (f) return f }
  return null
}

export const getActiveTerminal = (s: AppState): Terminal | null => {
  const f = getActiveFeature(s)
  return f?.terminals.find((t) => t.id === s.activeTerminalId) ?? null
}

export const allTerminals = (s: AppState): Terminal[] =>
  s.workspace.groups.flatMap((g) => g.features.flatMap((f) => f.terminals))
```

- [ ] **Step 4: Run store tests to verify they pass**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat: features-aware store reducers + activeFeatureId"
```

---

## Task 3: Sidebar — 3-level tree (groups → features → terminals)

**Files:**
- Modify (rewrite): `src/renderer/src/components/Sidebar.tsx`
- Modify (rewrite): `src/renderer/src/components/Sidebar.test.tsx`

The Sidebar gets an inline-rename helper reused for all three levels, renders the group cwd, and exposes callbacks for add/rename/delete/select/toggle/launch at each level.

- [ ] **Step 1: Replace `src/renderer/src/components/Sidebar.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Group } from '@shared/types'

const groups: Group[] = [
  { id: 'g1', name: 'proj', cwd: '/home/me/proj', collapsed: false, features: [
    { id: 'f1', name: 'auth', collapsed: false, terminals: [
      { id: 't1', name: 'claude', cwd: '/home/me/proj', kind: 'claude' }
    ] },
    { id: 'f2', name: 'ui', collapsed: true, terminals: [
      { id: 't2', name: 'dev', cwd: '/home/me/proj' }
    ] }
  ] }
]
function noop() {}

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = {
    groups,
    activeTerminalId: null as string | null,
    onSelectTerminal: noop,
    onToggleGroup: noop,
    onToggleFeature: noop,
    onAddGroup: noop,
    onAddFeature: noop,
    onAddTerminal: noop,
    onLaunchAgent: noop,
    onToggleFeatureView: noop,
    onRenameGroup: noop,
    onRenameFeature: noop,
    onRenameTerminal: noop,
    onDeleteGroup: noop,
    onDeleteFeature: noop,
    ...overrides
  }
  return render(<Sidebar {...props} />)
}

describe('Sidebar (3-level)', () => {
  it('renders groups, the group cwd, features, and terminals of expanded features', () => {
    renderSidebar({ activeTerminalId: 't1' })
    expect(screen.getByText('proj')).toBeInTheDocument()
    expect(screen.getByText('/home/me/proj')).toBeInTheDocument()
    expect(screen.getByText('auth')).toBeInTheDocument()
    expect(screen.getByText('ui')).toBeInTheDocument()
    expect(screen.getByText('claude')).toBeInTheDocument()   // f1 expanded
    expect(screen.queryByText('dev')).not.toBeInTheDocument() // f2 collapsed
  })

  it('selects a terminal on click and shows its kind icon', () => {
    const onSelectTerminal = vi.fn()
    renderSidebar({ onSelectTerminal })
    const item = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(within(item).getByTestId('icon-claude')).toBeInTheDocument()
  })

  it('adds a group via the bottom input', async () => {
    const onAddGroup = vi.fn()
    renderSidebar({ onAddGroup })
    await userEvent.click(screen.getByLabelText('Nova grupa'))
    expect(onAddGroup).toHaveBeenCalled()
  })

  it('adds a feature to a group', async () => {
    const onAddFeature = vi.fn()
    renderSidebar({ onAddFeature })
    await userEvent.type(screen.getByLabelText('Novi feature u proj'), 'payments{Enter}')
    expect(onAddFeature).toHaveBeenCalledWith('g1', 'payments')
  })

  it('adds a terminal to a feature inline (name only)', async () => {
    const onAddTerminal = vi.fn()
    renderSidebar({ onAddTerminal })
    await userEvent.type(screen.getByLabelText('Novi terminal u auth'), 'shell{Enter}')
    expect(onAddTerminal).toHaveBeenCalledWith('f1', 'shell')
  })

  it('launches claude/codex into a feature', async () => {
    const onLaunchAgent = vi.fn()
    renderSidebar({ onLaunchAgent })
    await userEvent.click(screen.getByLabelText('Novi Claude terminal u auth'))
    expect(onLaunchAgent).toHaveBeenCalledWith('f1', 'claude')
    await userEvent.click(screen.getByLabelText('Novi Codex terminal u auth'))
    expect(onLaunchAgent).toHaveBeenCalledWith('f1', 'codex')
  })

  it('renames a group, a feature and a terminal via double-click', async () => {
    const onRenameGroup = vi.fn(), onRenameFeature = vi.fn(), onRenameTerminal = vi.fn()
    renderSidebar({ onRenameGroup, onRenameFeature, onRenameTerminal })

    await userEvent.dblClick(screen.getByText('proj'))
    await userEvent.clear(screen.getByLabelText('Preimenuj grupu proj'))
    await userEvent.type(screen.getByLabelText('Preimenuj grupu proj'), 'proj2{Enter}')
    expect(onRenameGroup).toHaveBeenCalledWith('g1', 'proj2')

    await userEvent.dblClick(screen.getByText('auth'))
    await userEvent.clear(screen.getByLabelText('Preimenuj feature auth'))
    await userEvent.type(screen.getByLabelText('Preimenuj feature auth'), 'auth2{Enter}')
    expect(onRenameFeature).toHaveBeenCalledWith('f1', 'auth2')

    await userEvent.dblClick(screen.getByText('claude'))
    await userEvent.clear(screen.getByLabelText('Preimenuj terminal claude'))
    await userEvent.type(screen.getByLabelText('Preimenuj terminal claude'), 'c2{Enter}')
    expect(onRenameTerminal).toHaveBeenCalledWith('t1', 'c2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: FAIL — Sidebar doesn't match the new API.

- [ ] **Step 3: Replace `src/renderer/src/components/Sidebar.tsx`**

```tsx
import { useState } from 'react'
import type { Group } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ClaudeIcon, CodexIcon, GridIcon } from './icons'

type RenameKind = 'group' | 'feature' | 'terminal'

export function Sidebar(props: {
  groups: Group[]
  activeTerminalId: string | null
  onSelectTerminal: (id: string) => void
  onToggleGroup: (id: string) => void
  onToggleFeature: (id: string) => void
  onAddGroup: () => void
  onAddFeature: (groupId: string, name: string) => void
  onAddTerminal: (featureId: string, name: string) => void
  onLaunchAgent: (featureId: string, kind: AgentKind) => void
  onToggleFeatureView: (featureId: string) => void
  onRenameGroup: (id: string, name: string) => void
  onRenameFeature: (id: string, name: string) => void
  onRenameTerminal: (id: string, name: string) => void
  onDeleteGroup: (id: string) => void
  onDeleteFeature: (id: string) => void
}) {
  const {
    groups, activeTerminalId, onSelectTerminal, onToggleGroup, onToggleFeature, onAddGroup,
    onAddFeature, onAddTerminal, onLaunchAgent, onToggleFeatureView,
    onRenameGroup, onRenameFeature, onRenameTerminal, onDeleteGroup, onDeleteFeature
  } = props

  // one shared inline-rename slot { kind, id }
  const [editing, setEditing] = useState<{ kind: RenameKind; id: string } | null>(null)
  const [draft, setDraft] = useState('')
  const startRename = (kind: RenameKind, id: string, current: string) => { setEditing({ kind, id }); setDraft(current) }
  const commitRename = () => {
    if (!editing) return
    const name = draft.trim()
    if (name) {
      if (editing.kind === 'group') onRenameGroup(editing.id, name)
      else if (editing.kind === 'feature') onRenameFeature(editing.id, name)
      else onRenameTerminal(editing.id, name)
    }
    setEditing(null)
  }
  const isEditing = (kind: RenameKind, id: string) => editing?.kind === kind && editing.id === id
  const renameInput = (label: string) => (
    <input
      autoFocus aria-label={label} value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setEditing(null) }}
      className="flex-1 min-w-0 rounded bg-field px-1 text-sm text-fg-bright outline-none ring-1 ring-accent"
    />
  )

  // per-group / per-feature inline "add" inputs
  const [featureDraft, setFeatureDraft] = useState<Record<string, string>>({})
  const [terminalDraft, setTerminalDraft] = useState<Record<string, string>>({})
  const submitFeature = (gid: string) => {
    const name = (featureDraft[gid] ?? '').trim()
    if (name) { onAddFeature(gid, name); setFeatureDraft((d) => ({ ...d, [gid]: '' })) }
  }
  const submitTerminal = (fid: string) => {
    const name = (terminalDraft[fid] ?? '').trim()
    if (name) { onAddTerminal(fid, name); setTerminalDraft((d) => ({ ...d, [fid]: '' })) }
  }

  const hoverBtn = 'opacity-0 group-hover:opacity-100 px-1 text-fg-muted transition'

  return (
    <div className="w-64 shrink-0 h-full flex flex-col bg-panel border-r border-line text-fg">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--od-accent)]" />
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-fg-muted">OrchestriX</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {groups.map((g) => (
          <div key={g.id} className="select-none">
            {/* GROUP HEADER */}
            <div className="group flex items-center gap-1 px-2 py-1 hover:bg-hover">
              <button aria-label={`Skupi/raširi ${g.name}`} onClick={() => onToggleGroup(g.id)} className="w-4 text-fg-muted hover:text-fg">
                {g.collapsed ? '▸' : '▾'}
              </button>
              {isEditing('group', g.id) ? renameInput(`Preimenuj grupu ${g.name}`) : (
                <span className="flex-1 min-w-0 flex items-baseline gap-1.5 cursor-text" onDoubleClick={() => startRename('group', g.id, g.name)}>
                  <span className="truncate text-sm font-semibold text-fg-bright">{g.name}</span>
                  {g.cwd && <span className="truncate text-xs text-fg-muted/70">{g.cwd}</span>}
                </span>
              )}
              <button aria-label={`Obriši grupu ${g.name}`} onClick={() => onDeleteGroup(g.id)} className={`${hoverBtn} hover:text-danger`}>×</button>
            </div>

            {!g.collapsed && (
              <div className="pl-3">
                {g.features.map((f) => (
                  <div key={f.id}>
                    {/* FEATURE HEADER */}
                    <div className="group flex items-center gap-1 px-2 py-1 hover:bg-hover">
                      <button aria-label={`Skupi/raširi feature ${f.name}`} onClick={() => onToggleFeature(f.id)} className="w-4 text-fg-muted hover:text-fg">
                        {f.collapsed ? '▸' : '▾'}
                      </button>
                      {isEditing('feature', f.id) ? renameInput(`Preimenuj feature ${f.name}`) : (
                        <span className="flex-1 truncate text-sm font-medium text-fg cursor-text" onDoubleClick={() => startRename('feature', f.id, f.name)}>{f.name}</span>
                      )}
                      <button aria-label={`Novi Claude terminal u ${f.name}`} title="Claude" onClick={() => onLaunchAgent(f.id, 'claude')} className={`${hoverBtn} text-base leading-none`}><ClaudeIcon /></button>
                      <button aria-label={`Novi Codex terminal u ${f.name}`} title="Codex" onClick={() => onLaunchAgent(f.id, 'codex')} className={`${hoverBtn} text-base leading-none`}><CodexIcon /></button>
                      <button aria-label={`Grid prikaz ${f.name}`} title="Grid" onClick={() => onToggleFeatureView(f.id)} className={`${hoverBtn} ${(f.viewMode ?? 'tabs') === 'grid' ? 'text-accent opacity-100' : ''}`}><GridIcon /></button>
                      <button aria-label={`Obriši feature ${f.name}`} onClick={() => onDeleteFeature(f.id)} className={`${hoverBtn} hover:text-danger`}>×</button>
                    </div>

                    {!f.collapsed && (
                      <div className="pl-2">
                        {f.terminals.map((t) => {
                          const active = t.id === activeTerminalId
                          return (
                            <div key={t.id} data-term-id={t.id} onClick={() => onSelectTerminal(t.id)}
                              className={`group flex items-center gap-2 pl-6 pr-2 py-1 text-sm cursor-pointer border-l-2 transition-colors ${
                                active ? 'border-accent bg-sel text-fg-bright' : 'border-transparent text-fg hover:bg-hover hover:text-fg-bright'}`}>
                              <TerminalKindIcon kind={t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
                              {isEditing('terminal', t.id)
                                ? renameInput(`Preimenuj terminal ${t.name}`)
                                : <span className="truncate" onDoubleClick={(e) => { e.stopPropagation(); startRename('terminal', t.id, t.name) }}>{t.name}</span>}
                            </div>
                          )
                        })}
                        {/* inline add terminal */}
                        <input
                          aria-label={`Novi terminal u ${f.name}`} placeholder="+ terminal…"
                          value={terminalDraft[f.id] ?? ''}
                          onChange={(e) => setTerminalDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') submitTerminal(f.id) }}
                          className="ml-6 my-0.5 w-[calc(100%-1.75rem)] bg-transparent px-1 py-0.5 text-xs text-fg placeholder-fg-muted/60 outline-none focus:bg-field rounded"
                        />
                      </div>
                    )}
                  </div>
                ))}
                {/* inline add feature */}
                <input
                  aria-label={`Novi feature u ${g.name}`} placeholder="+ feature…"
                  value={featureDraft[g.id] ?? ''}
                  onChange={(e) => setFeatureDraft((d) => ({ ...d, [g.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitFeature(g.id) }}
                  className="ml-3 my-0.5 w-[calc(100%-1rem)] bg-transparent px-1 py-0.5 text-xs text-fg placeholder-fg-muted/60 outline-none focus:bg-field rounded"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-line">
        <button aria-label="Nova grupa" onClick={onAddGroup}
          className="w-full px-2 py-1.5 text-sm rounded-md bg-field text-fg-muted hover:text-accent outline-none transition">
          + Nova grupa
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run Sidebar tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat: 3-level Sidebar (groups/features/terminals) with inline rename + add"
```

---

## Task 4: NewGroupDialog (replaces NewTerminalDialog)

**Files:**
- Create: `src/renderer/src/components/NewGroupDialog.tsx`
- Create: `src/renderer/src/components/NewGroupDialog.test.tsx`
- Delete: `src/renderer/src/components/NewTerminalDialog.tsx`, `src/renderer/src/components/NewTerminalDialog.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/renderer/src/components/NewGroupDialog.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewGroupDialog } from './NewGroupDialog'

describe('NewGroupDialog', () => {
  it('submits name and cwd', async () => {
    const onCreate = vi.fn()
    render(<NewGroupDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Ime grupe'), 'proj')
    await userEvent.type(screen.getByLabelText('Radni direktorijum'), '/home/me/proj')
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'proj', cwd: '/home/me/proj' })
  })

  it('uses empty cwd (home) when left blank, but requires a name', async () => {
    const onCreate = vi.fn()
    render(<NewGroupDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).not.toHaveBeenCalled()           // no name
    await userEvent.type(screen.getByLabelText('Ime grupe'), 'g')
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'g', cwd: '' })
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(<NewGroupDialog onCreate={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Otkaži' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/NewGroupDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/renderer/src/components/NewGroupDialog.tsx`**

```tsx
import { useState } from 'react'

export interface NewGroupInput {
  name: string
  cwd: string
}

export function NewGroupDialog({
  onCreate, onCancel
}: {
  onCreate: (input: NewGroupInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')

  const submit = () => {
    const n = name.trim()
    if (!n) return
    onCreate({ name: n, cwd: cwd.trim() })
  }

  const field = 'mt-1 w-full rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[26rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold tracking-tight text-fg-bright">Nova grupa</h2>

        <label className="block mb-3 text-sm text-fg">
          Ime grupe
          <input autoFocus aria-label="Ime grupe" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field} />
        </label>

        <label className="block mb-4 text-sm text-fg">
          Radni direktorijum
          <input aria-label="Radni direktorijum" value={cwd} placeholder="~ (home ako prazno)"
            onChange={(e) => setCwd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field} />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors">Otkaži</button>
          <button onClick={submit} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:bg-accent-strong transition-colors">Kreiraj</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/NewGroupDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Delete the old dialog**

```bash
git rm src/renderer/src/components/NewTerminalDialog.tsx src/renderer/src/components/NewTerminalDialog.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: NewGroupDialog (name + cwd); remove NewTerminalDialog"
```

---

## Task 5: App rewrite — wire the 3-level model (brings typecheck GREEN)

**Files:**
- Modify (rewrite): `src/renderer/src/App.tsx`

- [ ] **Step 1: Replace `src/renderer/src/App.tsx`**

```tsx
// src/renderer/src/App.tsx
import { useEffect, useState } from 'react'
import { useStore } from './useStore'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode,
  addTerminal, renameTerminal, removeTerminal,
  setActiveTerminal,
  getActiveGroup, getActiveFeature, allTerminals
} from './store'
import { migrateWorkspace } from './migrate'
import { AGENTS, type AgentKind } from './agents'
import { gridDimensions } from './layout'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { NewGroupDialog, NewGroupInput } from './components/NewGroupDialog'

export default function App() {
  const { state, setState, apply } = useStore()
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.orchestrix.loadWorkspace().then((ws) => {
      setState(createInitialState(migrateWorkspace(ws)))
      setLoaded(true)
    })
  }, [setState])

  useEffect(() => {
    if (!loaded) return
    window.orchestrix.saveWorkspace(state.workspace)
  }, [state.workspace, loaded])

  const activeGroup = getActiveGroup(state)
  const activeFeature = getActiveFeature(state)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') {
        e.preventDefault()
        if (state.activeTerminalId) apply((s) => removeTerminal(s, state.activeTerminalId!))
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyG') {
        e.preventDefault()
        if (state.activeFeatureId) apply((s) => toggleFeatureViewMode(s, state.activeFeatureId!))
      } else if (e.ctrlKey && e.code === 'PageDown') {
        e.preventDefault(); cycleTab(1)
      } else if (e.ctrlKey && e.code === 'PageUp') {
        e.preventDefault(); cycleTab(-1)
      }
    }
    const cycleTab = (dir: number) => {
      const f = getActiveFeature(state)
      if (!f || f.terminals.length === 0) return
      const idx = f.terminals.findIndex((t) => t.id === state.activeTerminalId)
      const next = f.terminals[(idx + dir + f.terminals.length) % f.terminals.length]
      apply((s) => setActiveTerminal(s, next.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, apply])

  const launchAgent = (featureId: string, kind: AgentKind) => {
    const a = AGENTS[kind]
    apply((s) => addTerminal(s, featureId, { name: a.defaultName, startupCommand: a.command, kind }))
  }
  const createGroup = (input: NewGroupInput) => {
    apply((s) => addGroup(s, input.name, input.cwd))
    setGroupDialogOpen(false)
  }

  const terminals = allTerminals(state)
  const gridMode = (activeFeature?.viewMode ?? 'tabs') === 'grid'
  const featureTerminalIds = new Set((activeFeature?.terminals ?? []).map((t) => t.id))
  const { cols, rows } = gridDimensions(featureTerminalIds.size)

  return (
    <div className="flex h-screen text-fg bg-panel">
      <Sidebar
        groups={state.workspace.groups}
        activeTerminalId={state.activeTerminalId}
        onSelectTerminal={(id) => apply((s) => setActiveTerminal(s, id))}
        onToggleGroup={(id) => apply((s) => toggleGroupCollapsed(s, id))}
        onToggleFeature={(id) => apply((s) => toggleFeatureCollapsed(s, id))}
        onAddGroup={() => setGroupDialogOpen(true)}
        onAddFeature={(gid, name) => apply((s) => addFeature(s, gid, name))}
        onAddTerminal={(fid, name) => apply((s) => addTerminal(s, fid, { name }))}
        onLaunchAgent={launchAgent}
        onToggleFeatureView={(fid) => apply((s) => toggleFeatureViewMode(s, fid))}
        onRenameGroup={(id, name) => apply((s) => renameGroup(s, id, name))}
        onRenameFeature={(id, name) => apply((s) => renameFeature(s, id, name))}
        onRenameTerminal={(id, name) => apply((s) => renameTerminal(s, id, name))}
        onDeleteGroup={(id) => apply((s) => deleteGroup(s, id))}
        onDeleteFeature={(id) => apply((s) => deleteFeature(s, id))}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TabBar
          terminals={activeFeature?.terminals ?? []}
          activeId={state.activeTerminalId}
          viewMode={activeFeature?.viewMode ?? 'tabs'}
          onSelect={(id) => apply((s) => setActiveTerminal(s, id))}
          onClose={(id) => apply((s) => removeTerminal(s, id))}
          onAdd={() => { if (activeFeature) apply((s) => addTerminal(s, activeFeature.id, { name: 'shell' })) }}
          onLaunch={(kind) => { if (activeFeature) launchAgent(activeFeature.id, kind) }}
          onToggleView={() => { if (activeFeature) apply((s) => toggleFeatureViewMode(s, activeFeature.id)) }}
        />

        <div
          className={`relative flex-1 min-h-0 bg-surface ${gridMode ? 'grid gap-px bg-line' : ''}`}
          style={gridMode ? { gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0,1fr))` } : undefined}
        >
          {terminals.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-fg-muted">
              <span className="text-2xl font-semibold tracking-tight text-fg">OrchestriX</span>
              <span className="text-sm">{activeGroup ? 'Dodaj terminal u feature.' : 'Napravi grupu da počneš.'}</span>
            </div>
          )}
          {terminals.map((t) => {
            const inFeature = featureTerminalIds.has(t.id)
            const isActive = t.id === state.activeTerminalId
            if (gridMode && inFeature) {
              return (
                <div key={t.id} onMouseDown={() => apply((s) => setActiveTerminal(s, t.id))}
                  className={`relative min-h-0 min-w-0 bg-surface border ${isActive ? 'border-accent' : 'border-transparent'}`}>
                  <TerminalView terminal={t} active={isActive} />
                </div>
              )
            }
            const visible = inFeature && !gridMode && isActive
            return (
              <div key={t.id} className="absolute inset-0" style={{ display: visible ? 'block' : 'none' }}>
                <TerminalView terminal={t} active={isActive} />
              </div>
            )
          })}
        </div>
      </div>

      {groupDialogOpen && <NewGroupDialog onCreate={createGroup} onCancel={() => setGroupDialogOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 2: Type-check (now expected GREEN)**

Run: `npm run typecheck`
Expected: NO errors (the model migration is complete across all consumers).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (migrate, store, Sidebar, NewGroupDialog, TabBar, icons, layout, persistence, ptyManager, types, id).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: all bundles compile.

- [ ] **Step 5: Manual E2E (human step — note for the controller)**

`npm run dev`:
- "+ Nova grupa" → dialog (ime + cwd) → grupa sa default `general` feature.
- Grupa pokazuje cwd sivo; dvoklik na ime grupe/feature/terminala → rename.
- Inline "+ feature…" doda feature; inline "+ terminal…" doda terminal (cwd naslijeđen).
- Feature hover: Claude/Codex launch + grid toggle; tabovi/grid rade po aktivnom feature-u.
- Quit + relaunch → stari (v3) workspace se migrira u `general` feature, sve radi.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire 3-level hierarchy through App (typecheck green)"
```

---

## Task 6: Final verification

**Files:** none (verification) + README note.

- [ ] **Step 1: Add a "Hijerarhija" note to `README.md`**

Insert after the existing "## Brzo pokretanje agenata" section:

```markdown
## Hijerarhija

Grupa (sa radnim direktorijumom) → Feature → Terminal. Terminal nasljeđuje cwd
grupe. Dvoklik na ime grupe/feature-a/terminala ga preimenuje. Tabovi i grid
prikaz važe po aktivnom feature-u.
```

- [ ] **Step 2: Full verification**

Run: `npm test` (all pass) · `npm run typecheck` (clean) · `npm run build` (compiles).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Group/Feature/Terminal hierarchy"
```

---

## Self-Review Notes (author)

**Spec coverage (V4a portion):** 3-level model + migration → Task 1; cwd on group + inheritance → Tasks 1/2 (addTerminal pulls group cwd); store reducers/selectors + activeFeatureId → Task 2; Sidebar 3-level + cwd display + inline rename (all levels) + inline add feature/terminal + per-feature launch/grid → Task 3; group modal creation (name+cwd) → Task 4; tabs/grid per active feature + App wiring → Task 5; docs → Task 6. **Deferred to V4b:** Browse folder picker (`dialog:pickDirectory`), right-click context menu + Open-in-Files (`shell:openPath`), live agent icon detection (`pty.process` poller).

**Type consistency:** `Group.cwd/features`, `Feature` (Task 1) consumed by store (Task 2), migrate (Task 1), Sidebar (Task 3), App (Task 5). `AppState.activeFeatureId` (Task 2) used in App (Task 5). `addGroup(state,name,cwd)`, `addFeature(state,gid,name)`, `addTerminal(state,fid,{name,...})` signatures match call sites in App. Sidebar prop names (`onAddFeature`,`onAddTerminal`,`onToggleFeatureView`,`onRenameFeature`,`onDeleteFeature`, etc.) match App (Task 5) and the Sidebar test (Task 3). `TabBar` is unchanged — App feeds it the active feature's terminals/viewMode.

**Build-red window:** explicitly flagged — typecheck/build are RED from Task 1 to Task 5; each task verified by its own vitest run; Task 5 Step 2 restores green.

**Placeholder scan:** no TBD/TODO; all code complete.

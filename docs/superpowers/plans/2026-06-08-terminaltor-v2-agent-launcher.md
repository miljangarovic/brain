# Terminaltor V2 — Agent Launcher + Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click quick-launch buttons (with icons) to start `claude`/`codex` agent terminals, and show a per-kind icon in front of every terminal in the sidebar and tabs.

**Architecture:** A new `kind: 'shell' | 'claude' | 'codex'` field on `Terminal` (persisted, set explicitly at launch) drives the icon. A renderer-only `agents.ts` config maps an agent kind to its label/command/default-name. Small SVG icon components render per kind. TabBar and Sidebar gain quick-launch buttons that call back into App, which creates a pre-configured terminal via the existing `addTerminal` reducer.

**Tech Stack:** React + TypeScript, existing store reducers, Vitest + Testing Library. No new dependencies.

---

## File Structure

```
src/shared/types.ts                         # + TerminalKind type, Terminal.kind?
src/renderer/src/agents.ts                  # NEW: AgentKind + AGENTS config
src/renderer/src/store.ts                   # addTerminal gains optional kind
src/renderer/src/components/icons.tsx       # NEW: Claude/Codex/Shell + TerminalKindIcon
src/renderer/src/components/TabBar.tsx       # kind icon on tabs + launch buttons
src/renderer/src/components/Sidebar.tsx      # kind icon on items + per-group launch buttons
src/renderer/src/App.tsx                     # launchAgent glue
README.md                                    # document quick launch
```

**Backward compatibility:** `Terminal.kind` is optional; persisted workspaces from v1 have no `kind` and are read as `'shell'` via `terminal.kind ?? 'shell'`. Plain shells store no `kind` (omitted, like `startupCommand`).

---

## Task 1: Domain — TerminalKind, agents config, store support

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/renderer/src/agents.ts`
- Create: `src/renderer/src/agents.test.ts`
- Modify: `src/renderer/src/store.ts`
- Modify: `src/renderer/src/store.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/renderer/src/store.test.ts` (inside the existing `describe('store reducers', ...)` block, before its closing `})`):

```ts
  it('addTerminal stores an agent kind', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'claude', cwd: '', startupCommand: 'claude', kind: 'claude' })
    expect(s.workspace.groups[0].terminals[0].kind).toBe('claude')
  })

  it('addTerminal omits kind for plain shells', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'sh', cwd: '' })
    expect(s.workspace.groups[0].terminals[0].kind).toBeUndefined()
  })
```

Create `src/renderer/src/agents.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AGENTS } from './agents'

describe('AGENTS', () => {
  it('defines claude and codex with label, command and default name', () => {
    expect(AGENTS.claude.command).toBe('claude')
    expect(AGENTS.codex.command).toBe('codex')
    expect(AGENTS.claude.label).toBe('Claude')
    expect(AGENTS.codex.label).toBe('Codex')
    expect(AGENTS.claude.defaultName).toBeTruthy()
    expect(AGENTS.codex.defaultName).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `agents` module not found; `kind` not stored (claude test fails / `kind` is undefined where expected).

- [ ] **Step 3: Add `TerminalKind` to `src/shared/types.ts`**

Replace the `Terminal` interface and add the kind type:

```ts
export type TerminalKind = 'shell' | 'claude' | 'codex'

export interface Terminal {
  id: string
  name: string
  cwd: string            // '' means: resolve to home dir at spawn time
  startupCommand?: string
  shell?: string         // '' / undefined means: $SHELL || /bin/bash
  kind?: TerminalKind    // undefined === 'shell'
}
```

(Leave `Group`, `Workspace`, and `createWorkspace` unchanged.)

- [ ] **Step 4: Create `src/renderer/src/agents.ts`**

```ts
// Quick-launch agent definitions. `command` is assumed to be on PATH.
export type AgentKind = 'claude' | 'codex'

export interface AgentDef {
  label: string
  command: string
  defaultName: string
}

export const AGENTS: Record<AgentKind, AgentDef> = {
  claude: { label: 'Claude', command: 'claude', defaultName: 'claude' },
  codex: { label: 'Codex', command: 'codex', defaultName: 'codex' }
}
```

- [ ] **Step 5: Thread `kind` through `addTerminal` in `src/renderer/src/store.ts`**

Replace the existing `addTerminal` function with:

```ts
export function addTerminal(
  state: AppState,
  groupId: string,
  input: { name: string; cwd: string; startupCommand?: string; shell?: string; kind?: TerminalKind }
): AppState {
  const startupCommand = input.startupCommand?.trim()
  const shell = input.shell?.trim()
  const term: Terminal = {
    id: createId(),
    name: input.name,
    cwd: input.cwd,
    startupCommand: startupCommand || undefined,
    shell: shell || undefined,
    kind: input.kind && input.kind !== 'shell' ? input.kind : undefined
  }
  const groups = state.workspace.groups.map(g =>
    g.id === groupId ? { ...g, terminals: [...g.terminals, term] } : g)
  return { ...state, workspace: { groups }, activeGroupId: groupId, activeTerminalId: term.id }
}
```

Also update the import at the top of `store.ts` to bring in `TerminalKind`:

```ts
import { Workspace, Group, Terminal, TerminalKind, createWorkspace } from '@shared/types'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all prior tests + 2 new store tests + agents test).

- [ ] **Step 7: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: TerminalKind + agents config + store support"
```
(End the commit message with a blank line then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: Icon components

**Files:**
- Create: `src/renderer/src/components/icons.tsx`
- Create: `src/renderer/src/components/icons.test.tsx`

The icons are decorative (`aria-hidden`) with a stable `data-testid` for tests. Claude = clay-orange sunburst; Codex = OpenAI-green hexagon knot; Shell = prompt glyph (inherits `currentColor`). These are stylized marks, not exact trademarks.

- [ ] **Step 1: Write failing test**

```tsx
// src/renderer/src/components/icons.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalKindIcon } from './icons'

describe('TerminalKindIcon', () => {
  it('renders the matching icon per kind', () => {
    const { rerender } = render(<TerminalKindIcon kind="claude" />)
    expect(screen.getByTestId('icon-claude')).toBeInTheDocument()
    rerender(<TerminalKindIcon kind="codex" />)
    expect(screen.getByTestId('icon-codex')).toBeInTheDocument()
    rerender(<TerminalKindIcon kind="shell" />)
    expect(screen.getByTestId('icon-shell')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./icons`.

- [ ] **Step 3: Implement `src/renderer/src/components/icons.tsx`**

```tsx
import type { TerminalKind } from '@shared/types'

type IconProps = { className?: string }

export function ClaudeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-claude" aria-hidden="true" focusable="false"
      stroke="#d97757" strokeWidth="2.4" strokeLinecap="round"
    >
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => (
        <line key={a} x1="12" y1="12" x2="12" y2="3.5" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  )
}

export function CodexIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-codex" aria-hidden="true" focusable="false"
      fill="none" stroke="#10a37f" strokeWidth="2" strokeLinejoin="round"
    >
      <path d="M12 2.5 L20.4 7.25 V16.75 L12 21.5 L3.6 16.75 V7.25 Z" />
      <circle cx="12" cy="12" r="2.6" fill="#10a37f" stroke="none" />
    </svg>
  )
}

export function ShellIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-shell" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M5 8l3.5 4L5 16" />
      <path d="M12.5 16H18" />
    </svg>
  )
}

export function TerminalKindIcon({ kind, className }: { kind: TerminalKind; className?: string }) {
  if (kind === 'claude') return <ClaudeIcon className={className} />
  if (kind === 'codex') return <CodexIcon className={className} />
  return <ShellIcon className={className} />
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
git commit -m "feat: Claude/Codex/Shell icon components"
```
(End the commit message with the Co-Authored-By trailer as in Task 1.)

---

## Task 3: TabBar — kind icons + agent quick-launch

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`
- Modify: `src/renderer/src/components/TabBar.test.tsx`

- [ ] **Step 1: Replace `src/renderer/src/components/TabBar.test.tsx`**

```tsx
// src/renderer/src/components/TabBar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'
import type { Terminal } from '@shared/types'

const terms: Terminal[] = [
  { id: 'a', name: 'claude-api', cwd: '' },
  { id: 'b', name: 'tests', cwd: '' }
]
function noop() {}

describe('TabBar', () => {
  it('renders a tab per terminal and marks the active one', () => {
    render(<TabBar terminals={terms} activeId="a" onSelect={noop} onClose={noop} onAdd={noop} onLaunch={noop} />)
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.getByText('tests')).toBeInTheDocument()
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('claude-api')
  })

  it('calls onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={onSelect} onClose={noop} onAdd={noop} onLaunch={noop} />)
    await userEvent.click(screen.getByText('tests'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('calls onClose without selecting when the × is clicked', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={onSelect} onClose={onClose} onAdd={noop} onLaunch={noop} />)
    await userEvent.click(screen.getByLabelText('Zatvori tests'))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('calls onAdd when + is clicked', async () => {
    const onAdd = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={noop} onClose={noop} onAdd={onAdd} onLaunch={noop} />)
    await userEvent.click(screen.getByLabelText('Novi terminal'))
    expect(onAdd).toHaveBeenCalled()
  })

  it('launches an agent via its quick button', async () => {
    const onLaunch = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={noop} onClose={noop} onAdd={noop} onLaunch={onLaunch} />)
    await userEvent.click(screen.getByLabelText('Novi Claude terminal'))
    expect(onLaunch).toHaveBeenCalledWith('claude')
    await userEvent.click(screen.getByLabelText('Novi Codex terminal'))
    expect(onLaunch).toHaveBeenCalledWith('codex')
  })

  it('shows the kind icon on an agent tab', () => {
    const agentTerms: Terminal[] = [{ id: 'a', name: 'claude', cwd: '', kind: 'claude' }]
    render(<TabBar terminals={agentTerms} activeId="a" onSelect={noop} onClose={noop} onAdd={noop} onLaunch={noop} />)
    const tab = screen.getByRole('tab')
    expect(within(tab).getByTestId('icon-claude')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `onLaunch` not a prop / launch buttons + tab icon not present yet.

- [ ] **Step 3: Replace `src/renderer/src/components/TabBar.tsx`**

```tsx
// src/renderer/src/components/TabBar.tsx
import type { Terminal } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ClaudeIcon, CodexIcon } from './icons'

export function TabBar({
  terminals, activeId, onSelect, onClose, onAdd, onLaunch
}: {
  terminals: Terminal[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  onLaunch: (kind: AgentKind) => void
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: TabBar kind icons and agent quick-launch buttons"
```
(With the Co-Authored-By trailer.)

---

## Task 4: Sidebar — kind icons + per-group agent launch

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/Sidebar.test.tsx`

- [ ] **Step 1: Replace `src/renderer/src/components/Sidebar.test.tsx`**

```tsx
// src/renderer/src/components/Sidebar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Group } from '@shared/types'

const groups: Group[] = [
  { id: 'g1', name: 'feature-auth', collapsed: false, terminals: [
    { id: 't1', name: 'claude-api', cwd: '', kind: 'claude' }
  ] },
  { id: 'g2', name: 'devops', collapsed: true, terminals: [
    { id: 't2', name: 'deploy', cwd: '' }
  ] }
]
function noop() {}

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = {
    groups,
    activeTerminalId: null as string | null,
    onSelectTerminal: noop,
    onToggleGroup: noop,
    onAddGroup: noop,
    onRenameGroup: noop,
    onAddTerminal: noop,
    onDeleteGroup: noop,
    onLaunchAgent: noop,
    ...overrides
  }
  return render(<Sidebar {...props} />)
}

describe('Sidebar', () => {
  it('renders groups and the terminals of expanded groups only', () => {
    renderSidebar({ activeTerminalId: 't1' })
    expect(screen.getByText('feature-auth')).toBeInTheDocument()
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.queryByText('deploy')).not.toBeInTheDocument()
  })

  it('selects a terminal on click', async () => {
    const onSelectTerminal = vi.fn()
    renderSidebar({ onSelectTerminal })
    await userEvent.click(screen.getByText('claude-api'))
    expect(onSelectTerminal).toHaveBeenCalledWith('t1')
  })

  it('toggles a group when its caret is clicked', async () => {
    const onToggleGroup = vi.fn()
    renderSidebar({ onToggleGroup })
    await userEvent.click(screen.getByLabelText('Skupi/raširi feature-auth'))
    expect(onToggleGroup).toHaveBeenCalledWith('g1')
  })

  it('adds a group from the input on Enter', async () => {
    const onAddGroup = vi.fn()
    renderSidebar({ onAddGroup })
    await userEvent.type(screen.getByPlaceholderText('Nova grupa…'), 'feature-ui{Enter}')
    expect(onAddGroup).toHaveBeenCalledWith('feature-ui')
  })

  it('requests a new shell terminal for a group', async () => {
    const onAddTerminal = vi.fn()
    renderSidebar({ onAddTerminal })
    await userEvent.click(screen.getByLabelText('Novi terminal u feature-auth'))
    expect(onAddTerminal).toHaveBeenCalledWith('g1')
  })

  it('renames a group via double-click then Enter', async () => {
    const onRenameGroup = vi.fn()
    renderSidebar({ onRenameGroup })
    await userEvent.dblClick(screen.getByText('feature-auth'))
    const input = screen.getByLabelText('Preimenuj grupu feature-auth')
    await userEvent.clear(input)
    await userEvent.type(input, 'auth-v2{Enter}')
    expect(onRenameGroup).toHaveBeenCalledWith('g1', 'auth-v2')
  })

  it('launches claude/codex into a specific group', async () => {
    const onLaunchAgent = vi.fn()
    renderSidebar({ onLaunchAgent })
    await userEvent.click(screen.getByLabelText('Novi Claude terminal u feature-auth'))
    expect(onLaunchAgent).toHaveBeenCalledWith('g1', 'claude')
    await userEvent.click(screen.getByLabelText('Novi Codex terminal u feature-auth'))
    expect(onLaunchAgent).toHaveBeenCalledWith('g1', 'codex')
  })

  it('shows the kind icon in front of a terminal', () => {
    renderSidebar()
    const item = screen.getByText('claude-api').closest('[data-term-id]') as HTMLElement
    expect(within(item).getByTestId('icon-claude')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `onLaunchAgent` not a prop / launch buttons + kind icon + `data-term-id` not present.

- [ ] **Step 3: Replace `src/renderer/src/components/Sidebar.tsx`**

```tsx
import { useState } from 'react'
import type { Group } from '@shared/types'
import type { AgentKind } from '../agents'
import { TerminalKindIcon, ClaudeIcon, CodexIcon } from './icons'

export function Sidebar({
  groups, activeTerminalId, onSelectTerminal, onToggleGroup, onAddGroup, onRenameGroup, onAddTerminal, onDeleteGroup, onLaunchAgent
}: {
  groups: Group[]
  activeTerminalId: string | null
  onSelectTerminal: (id: string) => void
  onToggleGroup: (id: string) => void
  onAddGroup: (name: string) => void
  onRenameGroup: (id: string, name: string) => void
  onAddTerminal: (groupId: string) => void
  onDeleteGroup: (id: string) => void
  onLaunchAgent: (groupId: string, kind: AgentKind) => void
}) {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const submitGroup = () => {
    const name = draft.trim()
    if (!name) return
    onAddGroup(name)
    setDraft('')
  }

  const startRename = (id: string, current: string) => {
    setEditingId(id)
    setEditDraft(current)
  }
  const commitRename = () => {
    if (!editingId) return
    const name = editDraft.trim()
    if (name) onRenameGroup(editingId, name)
    setEditingId(null)
  }

  const hoverBtn = 'opacity-0 group-hover:opacity-100 px-1 text-fg-muted transition'

  return (
    <div className="w-60 shrink-0 h-full flex flex-col bg-panel border-r border-line text-fg">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--od-accent)]" />
        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-fg-muted">Terminaltor</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {groups.map((g) => (
          <div key={g.id} className="select-none">
            <div className="group flex items-center gap-1 px-2 py-1 hover:bg-hover">
              <button
                aria-label={`Skupi/raširi ${g.name}`}
                onClick={() => onToggleGroup(g.id)}
                className="w-4 text-fg-muted hover:text-fg transition-colors"
              >
                {g.collapsed ? '▸' : '▾'}
              </button>
              {editingId === g.id ? (
                <input
                  autoFocus
                  aria-label={`Preimenuj grupu ${g.name}`}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 min-w-0 rounded bg-field px-1 text-sm text-fg-bright outline-none ring-1 ring-accent"
                />
              ) : (
                <span
                  className="flex-1 truncate text-sm font-medium text-fg-bright cursor-text"
                  title="Dvoklik za preimenovanje"
                  onDoubleClick={() => startRename(g.id, g.name)}
                >
                  {g.name}
                </span>
              )}
              <button
                aria-label={`Novi Claude terminal u ${g.name}`}
                title="Claude"
                onClick={() => onLaunchAgent(g.id, 'claude')}
                className={`${hoverBtn} text-base leading-none`}
              >
                <ClaudeIcon />
              </button>
              <button
                aria-label={`Novi Codex terminal u ${g.name}`}
                title="Codex"
                onClick={() => onLaunchAgent(g.id, 'codex')}
                className={`${hoverBtn} text-base leading-none`}
              >
                <CodexIcon />
              </button>
              <button
                aria-label={`Novi terminal u ${g.name}`}
                onClick={() => onAddTerminal(g.id)}
                className={`${hoverBtn} hover:text-accent`}
              >
                +
              </button>
              <button
                aria-label={`Obriši grupu ${g.name}`}
                onClick={() => onDeleteGroup(g.id)}
                className={`${hoverBtn} hover:text-danger`}
              >
                ×
              </button>
            </div>
            {!g.collapsed && g.terminals.map((t) => {
              const isActive = t.id === activeTerminalId
              return (
                <div
                  key={t.id}
                  data-term-id={t.id}
                  onClick={() => onSelectTerminal(t.id)}
                  className={`flex items-center gap-2 pl-6 pr-2 py-1 text-sm cursor-pointer border-l-2 transition-colors ${
                    isActive
                      ? 'border-accent bg-sel text-fg-bright'
                      : 'border-transparent text-fg hover:bg-hover hover:text-fg-bright'
                  }`}
                >
                  <TerminalKindIcon kind={t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
                  <span className="truncate">{t.name}</span>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-line">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitGroup() }}
          placeholder="Nova grupa…"
          className="w-full px-2 py-1.5 text-sm rounded-md bg-field text-fg placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Sidebar kind icons and per-group agent launch"
```
(With the Co-Authored-By trailer.)

---

## Task 5: App glue — wire the launch handlers

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add the agents import to `App.tsx`**

Add after the existing component imports (e.g. after the `NewTerminalDialog` import line):

```tsx
import { AGENTS, AgentKind } from './agents'
```

- [ ] **Step 2: Add the `launchAgent` handler**

Inside the `App` component, add this just after the existing `createTerminal` function:

```tsx
  const launchAgent = (groupId: string, kind: AgentKind) => {
    const a = AGENTS[kind]
    apply((s) => addTerminal(s, groupId, { name: a.defaultName, cwd: '', startupCommand: a.command, kind }))
  }
```

- [ ] **Step 3: Pass `onLaunch` to `TabBar`**

In the `<TabBar ... />` JSX, add the `onLaunch` prop (the tab bar acts on the active group):

```tsx
          onAdd={openDialog}
          onLaunch={(kind) => { if (state.activeGroupId) launchAgent(state.activeGroupId, kind) }}
```

(Insert the `onLaunch` line immediately after the existing `onAdd={openDialog}` line, inside the `<TabBar>` props.)

- [ ] **Step 4: Pass `onLaunchAgent` to `Sidebar`**

In the `<Sidebar ... />` JSX, add the `onLaunchAgent` prop after `onDeleteGroup`:

```tsx
        onDeleteGroup={(id) => apply((s) => deleteGroup(s, id))}
        onLaunchAgent={launchAgent}
```

- [ ] **Step 5: Type-check, test, build**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: PASS (all tests).

Run: `npm run build`
Expected: all bundles compile.

- [ ] **Step 6: Manual E2E (human step — note for the controller)**

Run `npm run dev` and verify:
- TabBar shows `+`, a Claude icon button, and a Codex icon button. Clicking Claude creates a terminal named `claude` running `claude`, with the Claude icon on its tab and in the sidebar.
- Codex button does the same with `codex`.
- Sidebar group hover reveals Claude/Codex/+/× actions; the agent buttons launch into that group.
- Quit and relaunch → agent terminals restore with their icon and re-run their command.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire claude/codex quick-launch in App"
```
(With the Co-Authored-By trailer.)

---

## Task 6: README + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Brzo pokretanje agenata" section to `README.md`**

Insert this section after the existing `## Prečice` section:

```markdown
## Brzo pokretanje agenata

U tab baru (i na hover grupe u sidebar-u) pored `+` stoje dugmad **Claude** i
**Codex**. Jedan klik kreira terminal koji odmah pokreće taj agent (`claude` /
`codex` se očekuju na PATH-u). Terminali koji koriste agenta nose njegovu ikonicu
u sidebar-u i u tabovima, i pamte se kroz restart.
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

Run: `npm run typecheck`
Expected: clean.

Run: `npm run build`
Expected: all bundles compile.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: document claude/codex quick launch"
```
(With the Co-Authored-By trailer.)

---

## Self-Review Notes (author)

**Spec coverage:** kind field + persistence → Task 1; agent config (fixed commands) → Task 1; icons per kind → Task 2; quick-launch buttons (TabBar) → Task 3; quick-launch buttons (Sidebar per group) → Task 4; icons in front of terminals (tabs + sidebar) → Tasks 3/4; App wiring + active-group launch + restore → Task 5; docs → Task 6.

**Type consistency:** `TerminalKind` ('shell'|'claude'|'codex') defined in types.ts (Task 1) and consumed by icons (Task 2), TabBar/Sidebar (Tasks 3/4). `AgentKind` ('claude'|'codex') and `AGENTS` defined in agents.ts (Task 1), consumed by TabBar/Sidebar/App. `addTerminal` input gains `kind?: TerminalKind` (Task 1) and is called with `kind` in App.launchAgent (Task 5). Prop names `onLaunch` (TabBar) and `onLaunchAgent` (Sidebar) are consistent between component definitions, their tests, and the App call sites.

**Backward compatibility:** `Terminal.kind` optional; v1 persisted terminals read as 'shell' via `t.kind ?? 'shell'`; plain shells omit `kind`.

**Out of scope (correctly deferred):** keyboard shortcuts for launch, configurable agent command (Settings), cwd selection at quick-launch.
```

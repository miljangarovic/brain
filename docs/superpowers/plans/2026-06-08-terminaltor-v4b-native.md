# Terminaltor V4b — Native Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the deferred V4 native features: a Browse folder picker for the group cwd, a right-click group menu with "Open in Files", and live agent-icon detection (the terminal icon reflects `claude`/`codex` actually running, reverting when it exits).

**Architecture:** Three new IPC paths — `dialog:pickDirectory` (native folder picker), `shell:openPath` (open a path in the system file manager), and `pty:proc` (main polls each PTY's foreground process name and pushes changes). A pure `detectAgent(name)` maps a process name to an agent kind; the renderer keeps a transient `liveAgents` map and resolves each terminal's icon as `liveAgents[id] ?? terminal.kind ?? 'shell'`.

**Tech Stack:** Electron `dialog`/`shell`, node-pty `.process`, React + Vitest. No new deps.

> **Limitation (document, don't fight):** live detection reads node-pty's `.process` (the pty's foreground process name). Agents whose process name contains `claude`/`codex` are detected; some installs surface as `node` and won't be — the static `kind` from quick-launch still covers those.

---

## File Structure

```
src/renderer/src/agents.ts                 # + detectAgent(name)
src/shared/ipc.ts                          # + dialogPickDirectory, shellOpenPath, ptyProc
src/shared/api.ts                          # + pickDirectory, openPath, onPtyProc
src/preload/index.ts                       # implement the 3 new api methods
src/shared/pty.ts                          # PtyHandle.processName()
src/main/nodePtySpawner.ts                 # processName impl
src/main/ptyManager.ts                     # snapshotProcesses()
src/main/ptyManager.test.ts                # fake handle processName + test
src/main/ipc.ts                            # pickDirectory + openPath handlers + pty:proc poller
src/renderer/src/App.tsx                   # liveAgents state + subscribe + openPath wiring
src/renderer/src/components/Sidebar.tsx    # liveAgents prop + right-click menu + Open-in-Files
src/renderer/src/components/TabBar.tsx     # liveAgents prop (icon resolution)
src/renderer/src/components/ContextMenu.tsx# NEW: small positioned menu
src/renderer/src/components/NewGroupDialog.tsx # Browse button
```

---

## Task 1: detectAgent

**Files:**
- Modify: `src/renderer/src/agents.ts`
- Create: `src/renderer/src/agents.detect.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/renderer/src/agents.detect.test.ts
import { describe, it, expect } from 'vitest'
import { detectAgent } from './agents'

describe('detectAgent', () => {
  it('maps a process name to an agent kind by substring (case-insensitive)', () => {
    expect(detectAgent('claude')).toBe('claude')
    expect(detectAgent('/usr/local/bin/codex')).toBe('codex')
    expect(detectAgent('Claude')).toBe('claude')
    expect(detectAgent('node claude')).toBe('claude')
  })
  it('returns null for non-agents / empty', () => {
    expect(detectAgent('bash')).toBeNull()
    expect(detectAgent('')).toBeNull()
    expect(detectAgent(undefined)).toBeNull()
    expect(detectAgent(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/agents.detect.test.ts`
Expected: FAIL — `detectAgent` not exported.

- [ ] **Step 3: Add `detectAgent` to `src/renderer/src/agents.ts`** (append):

```ts
export function detectAgent(processName: string | null | undefined): AgentKind | null {
  if (!processName) return null
  const p = processName.toLowerCase()
  if (p.includes('claude')) return 'claude'
  if (p.includes('codex')) return 'codex'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/agents.detect.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

Run: `npm run typecheck` (clean)

```bash
git add src/renderer/src/agents.ts src/renderer/src/agents.detect.test.ts
git commit -m "feat: detectAgent(processName)"
```
(End every commit message with a blank line then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: IPC contracts + preload (additive, typecheck green)

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add channels to `src/shared/ipc.ts`**

Add three entries to the `IPC` object (before the closing `}`):

```ts
  dialogPickDirectory: 'dialog:pickDirectory',
  shellOpenPath: 'shell:openPath',
  ptyProc: 'pty:proc'
```

- [ ] **Step 2: Add methods to `TerminaltorApi` in `src/shared/api.ts`**

Add to the interface:

```ts
  pickDirectory(): Promise<string | null>
  openPath(path: string): void
  onPtyProc(cb: (id: string, process: string) => void): () => void
```

- [ ] **Step 3: Implement them in `src/preload/index.ts`**

Add these three properties to the `api` object (alongside the existing ones):

```ts
  pickDirectory: () => ipcRenderer.invoke(IPC.dialogPickDirectory) as Promise<string | null>,
  openPath: (path: string) => ipcRenderer.send(IPC.shellOpenPath, { path }),
  onPtyProc: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { id: string; process: string }) => cb(p.id, p.process)
    ipcRenderer.on(IPC.ptyProc, listener)
    return () => ipcRenderer.removeListener(IPC.ptyProc, listener)
  },
```

- [ ] **Step 4: Type-check + tests**

Run: `npm run typecheck` (clean — additive)
Run: `npm test` (still 56 pass — nothing consumes the new methods yet)

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts
git commit -m "feat: IPC contracts for pickDirectory/openPath/onPtyProc"
```

---

## Task 3: Main handlers — pickDirectory + openPath

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Update the imports at the top of `src/main/ipc.ts`**

Replace the electron import line and add `os`:

```ts
import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import * as os from 'os'
```

- [ ] **Step 2: Register the two handlers inside `registerIpc` (after the existing `ipcMain.on(IPC.ptyKill, ...)` line)**

```ts
  ipcMain.handle(IPC.dialogPickDirectory, async () => {
    const win = getWin()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  ipcMain.on(IPC.shellOpenPath, (_e, p: { path: string }) => { void shell.openPath(p.path || os.homedir()) })
```

- [ ] **Step 3: Type-check + build**

Run: `npm run typecheck` (clean)
Run: `npm run build` (compiles)

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: main handlers for native folder picker and open-path"
```

---

## Task 4: PTY process name + poller

**Files:**
- Modify: `src/shared/pty.ts`
- Modify: `src/main/nodePtySpawner.ts`
- Modify: `src/main/ptyManager.ts`
- Modify: `src/main/ptyManager.test.ts`
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Add `processName` to `PtyHandle` in `src/shared/pty.ts`**

Add to the `PtyHandle` interface:

```ts
  processName(): string
```

- [ ] **Step 2: Add a failing test to `src/main/ptyManager.test.ts`**

In `makeFake()`, add `processName` to the returned handle object (add this property alongside `write`/`resize`/etc.):

```ts
      processName: () => 'bash',
```

Then append this test inside the `describe('PtyManager', ...)` block:

```ts
  it('snapshotProcesses lists the foreground process per live terminal', () => {
    const { spawner } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    m.create({ id: 't2', cwd: '', shell: '', cols: 80, rows: 24 })
    expect(m.snapshotProcesses()).toEqual([
      { id: 't1', process: 'bash' },
      { id: 't2', process: 'bash' }
    ])
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ptyManager.test.ts`
Expected: FAIL — `snapshotProcesses` not a method (and the `PtyHandle` type now requires `processName`).

- [ ] **Step 4: Add `snapshotProcesses` to `src/main/ptyManager.ts`**

Add this method to the `PtyManager` class (after `has`):

```ts
  snapshotProcesses(): { id: string; process: string }[] {
    return Array.from(this.handles.entries()).map(([id, h]) => ({ id, process: h.processName() }))
  }
```

- [ ] **Step 5: Implement `processName` in `src/main/nodePtySpawner.ts`**

Add to the `handle` object:

```ts
    processName: () => proc.process ?? '',
```

- [ ] **Step 6: Add the poller to `registerIpc` in `src/main/ipc.ts`**

Add `import { IPC }` already exists. After the handlers (and before `return saver`), add:

```ts
  // Poll each PTY's foreground process name; push changes so the renderer can
  // show a live agent icon (claude/codex) and revert it when the agent exits.
  const lastProc = new Map<string, string>()
  setInterval(() => {
    const win = getWin()
    if (!win || win.isDestroyed()) return
    for (const { id, process } of ptyManager.snapshotProcesses()) {
      if (lastProc.get(id) !== process) {
        lastProc.set(id, process)
        win.webContents.send(IPC.ptyProc, { id, process })
      }
    }
  }, 1000)
```

- [ ] **Step 7: Verify**

Run: `npx vitest run src/main/ptyManager.test.ts` (PASS)
Run: `npm run typecheck` (clean)
Run: `npm run build` (compiles)

- [ ] **Step 8: Commit**

```bash
git add src/shared/pty.ts src/main/nodePtySpawner.ts src/main/ptyManager.ts src/main/ptyManager.test.ts src/main/ipc.ts
git commit -m "feat: pty process-name snapshot + pty:proc poller"
```

---

## Task 5: Renderer live agent icons

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`
- Modify: `src/renderer/src/components/TabBar.test.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/Sidebar.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add a `liveAgents` prop to TabBar + a test**

In `src/renderer/src/components/TabBar.test.tsx`, add `liveAgents={{}}` to every existing `render(<TabBar ... />)` call, then append:

```tsx
  it('a live agent overrides the tab icon', () => {
    const t = [{ id: 'a', name: 'work', cwd: '' }]
    render(<TabBar terminals={t} activeId="a" viewMode="tabs" liveAgents={{ a: 'claude' }}
      onSelect={noop} onClose={noop} onAdd={noop} onLaunch={noop} onToggleView={noop} />)
    const tab = screen.getByRole('tab')
    expect(within(tab).getByTestId('icon-claude')).toBeInTheDocument()
  })
```

(Ensure `within` is imported from `@testing-library/react` in the test file.)

- [ ] **Step 2: Update `src/renderer/src/components/TabBar.tsx`**

Add `liveAgents` to the props type and destructuring:

```tsx
  liveAgents: Record<string, 'claude' | 'codex' | undefined>
```

Add `liveAgents` to the function's destructured params, then change the tab icon line from:

```tsx
            <TerminalKindIcon kind={t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
```

to:

```tsx
            <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
```

- [ ] **Step 3: Add a `liveAgents` prop to Sidebar + a test**

In `src/renderer/src/components/Sidebar.test.tsx`, add `liveAgents: {}` to the `renderSidebar` default props object, then append:

```tsx
  it('a live agent wins over the static kind on a visible terminal', () => {
    // t1 has static kind 'claude'; a live 'codex' detection must override the icon.
    renderSidebar({ liveAgents: { t1: 'codex' } })
    const item = screen.getByText('claude').closest('[data-term-id]') as HTMLElement
    expect(within(item).getByTestId('icon-codex')).toBeInTheDocument()
  })
```

(`renderSidebar` already imports `within`; ensure it's in the test file's import from `@testing-library/react`.)

- [ ] **Step 4: Update `src/renderer/src/components/Sidebar.tsx`**

Add `liveAgents: Record<string, 'claude' | 'codex' | undefined>` to the props type, destructure it, and change the terminal icon line from:

```tsx
                              <TerminalKindIcon kind={t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
```

to:

```tsx
                              <TerminalKindIcon kind={liveAgents[t.id] ?? t.kind ?? 'shell'} className="shrink-0 text-fg-muted" />
```

- [ ] **Step 5: Wire `liveAgents` in `src/renderer/src/App.tsx`**

Add the `detectAgent` import:

```tsx
import { AGENTS, detectAgent, type AgentKind } from './agents'
```

Add state + subscription (after the `const [loaded, setLoaded] = useState(false)` line, and a new effect):

```tsx
  const [liveAgents, setLiveAgents] = useState<Record<string, AgentKind | undefined>>({})
  useEffect(() => {
    return window.terminaltor.onPtyProc((id, process) => {
      setLiveAgents((m) => ({ ...m, [id]: detectAgent(process) ?? undefined }))
    })
  }, [])
```

Pass `liveAgents={liveAgents}` to BOTH `<Sidebar ... />` and `<TabBar ... />`.

- [ ] **Step 6: Verify**

Run: `npm test` (all pass — TabBar + Sidebar new tests)
Run: `npm run typecheck` (clean)
Run: `npm run build` (compiles)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: live agent icons (claude/codex detection)"
```

---

## Task 6: Browse button in NewGroupDialog

**Files:**
- Modify: `src/renderer/src/components/NewGroupDialog.tsx`
- Modify: `src/renderer/src/components/NewGroupDialog.test.tsx`

- [ ] **Step 1: Add a failing test**

Append to `src/renderer/src/components/NewGroupDialog.test.tsx`:

```tsx
  it('fills cwd from the native folder picker', async () => {
    ;(window as unknown as { terminaltor: { pickDirectory: () => Promise<string | null> } }).terminaltor = {
      pickDirectory: vi.fn().mockResolvedValue('/picked/dir')
    }
    const onCreate = vi.fn()
    render(<NewGroupDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    await userEvent.type(screen.getByLabelText('Ime grupe'), 'g')
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'g', cwd: '/picked/dir' })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/NewGroupDialog.test.tsx`
Expected: FAIL — no "Browse…" button.

- [ ] **Step 3: Add the Browse button in `src/renderer/src/components/NewGroupDialog.tsx`**

Add a browse handler inside the component (after `submit`):

```tsx
  const browse = async () => {
    const dir = await window.terminaltor.pickDirectory()
    if (dir) setCwd(dir)
  }
```

Replace the "Radni direktorijum" label block with one that puts the input and a Browse button side by side:

```tsx
        <label className="block mb-4 text-sm text-fg">
          Radni direktorijum
          <div className="mt-1 flex gap-2">
            <input aria-label="Radni direktorijum" value={cwd} placeholder="~ (home ako prazno)"
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              className="flex-1 rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition" />
            <button type="button" onClick={browse}
              className="shrink-0 rounded-md px-3 py-1.5 text-sm text-fg ring-1 ring-line hover:bg-hover transition-colors">Browse…</button>
          </div>
        </label>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/NewGroupDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

Run: `npm run typecheck` (clean)

```bash
git add src/renderer/src/components/NewGroupDialog.tsx src/renderer/src/components/NewGroupDialog.test.tsx
git commit -m "feat: Browse folder picker in NewGroupDialog"
```

---

## Task 7: Right-click group menu (Rename + Open in Files)

**Files:**
- Create: `src/renderer/src/components/ContextMenu.tsx`
- Create: `src/renderer/src/components/ContextMenu.test.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/Sidebar.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write a failing test for `ContextMenu`**

```tsx
// src/renderer/src/components/ContextMenu.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextMenu } from './ContextMenu'

describe('ContextMenu', () => {
  it('renders items and fires their action, then closes', async () => {
    const onClose = vi.fn(), a = vi.fn()
    render(<ContextMenu x={10} y={20} onClose={onClose} items={[{ label: 'Rename', onSelect: a }]} />)
    await userEvent.click(screen.getByText('Rename'))
    expect(a).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/components/ContextMenu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/renderer/src/components/ContextMenu.tsx`**

```tsx
import { useEffect } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-40 rounded-md border border-line bg-elevated py-1 shadow-xl shadow-black/50"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          onClick={() => { it.onSelect(); onClose() }}
          className="block w-full px-3 py-1.5 text-left text-sm text-fg hover:bg-hover"
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/components/ContextMenu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the menu into `src/renderer/src/components/Sidebar.tsx`**

Add the import at the top:

```tsx
import { ContextMenu } from './ContextMenu'
```

Add an `onOpenInFiles: (groupId: string) => void` prop to the Sidebar props type and destructure it.

Add menu state near the other `useState`s:

```tsx
  const [menu, setMenu] = useState<{ x: number; y: number; groupId: string } | null>(null)
```

On the GROUP header `<div className="group flex items-center gap-1 px-2 py-1 hover:bg-hover">`, add an `onContextMenu`:

```tsx
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, groupId: g.id }) }}
```

Just before the final closing `</div>` of the component (after the bottom "+ Nova grupa" block), render the menu:

```tsx
      {menu && (() => {
        const g = groups.find((x) => x.id === menu.groupId)
        if (!g) return null
        return (
          <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
            { label: 'Preimenuj', onSelect: () => startRename('group', g.id, g.name) },
            { label: 'Open in Files', onSelect: () => onOpenInFiles(g.id) }
          ]} />
        )
      })()}
```

- [ ] **Step 6: Update `src/renderer/src/components/Sidebar.test.tsx`**

Add `onOpenInFiles: noop` to the `renderSidebar` default props, then append:

```tsx
  it('right-click on a group offers Open in Files', async () => {
    const onOpenInFiles = vi.fn()
    renderSidebar({ onOpenInFiles })
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.contextMenu(screen.getByText('proj'))
    await userEvent.click(screen.getByText('Open in Files'))
    expect(onOpenInFiles).toHaveBeenCalledWith('g1')
  })
```

- [ ] **Step 7: Wire `onOpenInFiles` in `src/renderer/src/App.tsx`**

Add to the `<Sidebar ... />` props:

```tsx
        onOpenInFiles={(gid) => {
          const g = state.workspace.groups.find((x) => x.id === gid)
          window.terminaltor.openPath(g?.cwd ?? '')
        }}
```

- [ ] **Step 8: Verify**

Run: `npm test` (all pass) · `npm run typecheck` (clean) · `npm run build` (compiles)

- [ ] **Step 9: Manual E2E (human step — note for the controller)**

`npm run dev`:
- New group → dialog → **Browse…** opens the native folder picker; chosen dir fills cwd.
- Right-click a group → menu with **Preimenuj** (enters inline rename) and **Open in Files** (opens the group cwd in the file manager).
- Open a plain terminal, run `claude` → its icon switches to the Claude mark within ~1s; exit `claude` → reverts to the shell glyph. (If your `claude` shows as `node`, detection won't fire — quick-launch icons still work.)

- [ ] **Step 10: Commit + README note**

Add to `README.md` after the "## Hijerarhija" section:

```markdown
## Native

- **Browse…** u dijalogu nove grupe bira radni direktorijum nativnim pickerom.
- **Desni klik na grupu** → Preimenuj / Open in Files (otvori cwd u file manageru).
- Ikonica terminala se uživo mijenja kad `claude`/`codex` radi (i vraća kad izađe).
```

```bash
git add -A
git commit -m "feat: right-click group menu (Open in Files) + docs"
```

---

## Self-Review Notes (author)

**Spec coverage (V4b):** Browse folder picker → Tasks 2/3 (pickDirectory IPC) + 6 (button); Open in Files → Tasks 2/3 (openPath IPC) + 7 (context menu + App wiring); live agent icon → Task 1 (detectAgent) + 2/4 (onPtyProc + poller) + 5 (renderer liveAgents + icon resolution).

**Type consistency:** `detectAgent` returns `AgentKind | null` (Task 1), used in App (Task 5). New IPC channels (Task 2) consumed by main handlers (Task 3) + poller (Task 4); `pickDirectory`/`openPath`/`onPtyProc` on `TerminaltorApi` (Task 2) implemented in preload (Task 2) and called in NewGroupDialog (Task 6) / App (Tasks 5,7). `PtyHandle.processName` (Task 4) implemented by nodePtySpawner + fake; `ptyManager.snapshotProcesses` feeds the poller. `liveAgents: Record<string,'claude'|'codex'|undefined>` prop shape identical in TabBar, Sidebar, and App.

**Green between tasks:** every task is additive; `npm run typecheck` stays green throughout (verify per task). Task 4 makes `PtyHandle.processName` required — the fake (test) and nodePtySpawner are both updated in the same task.

**Placeholder scan:** no TBD/TODO; all code complete. (Task 5 Step 3 includes an explicit note to keep the single meaningful "live agent wins" assertion.)
```

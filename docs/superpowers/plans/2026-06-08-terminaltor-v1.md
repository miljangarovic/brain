# Terminaltor v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Linux desktop app (Electron) that wraps real terminals, lets you create named terminals with full PTY behavior, and groups them (sidebar tree + tabs) — primarily to organize AI agents per feature.

**Architecture:** Electron split — main process owns real shells (`node-pty`) and JSON persistence; renderer (React) draws the sidebar/tabs and `xterm.js` panes. They talk over a typed IPC bridge exposed via a secure preload (`contextIsolation: on`). PTY lifecycle lives in main, so terminals stay alive while hidden.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, Tailwind, `@xterm/xterm` + `@xterm/addon-fit`, `node-pty`, Vitest + Testing Library.

---

## File Structure

```
terminaltor/
├── package.json
├── electron.vite.config.ts          # electron-vite (main/preload/renderer)
├── tsconfig.json
├── vitest.config.ts                 # jsdom env, globals
├── vitest.setup.ts
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── shared/                       # types shared by all 3 processes
│   │   ├── types.ts                  # Workspace/Group/Terminal + createWorkspace
│   │   ├── id.ts                     # createId()
│   │   ├── pty.ts                    # PtyHandle, PtySpawner, PtyCreateOptions
│   │   ├── ipc.ts                    # IPC channel name constants
│   │   └── api.ts                    # TerminaltorApi interface (preload surface)
│   ├── main/
│   │   ├── index.ts                  # app/window lifecycle
│   │   ├── ptyManager.ts             # PtyManager (DI spawner) — testable logic
│   │   ├── nodePtySpawner.ts         # real node-pty spawner (native)
│   │   ├── persistence.ts            # load/write/debounced-save workspace JSON
│   │   └── ipc.ts                    # registerIpc — wires channels
│   ├── preload/
│   │   └── index.ts                  # contextBridge → window.terminaltor
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx              # React entry (no StrictMode)
│           ├── App.tsx               # composition + IPC glue
│           ├── store.ts              # pure AppState reducers + selectors
│           ├── useStore.ts           # React hook around reducers
│           ├── index.css             # tailwind + full-height
│           ├── global.d.ts           # window.terminaltor typing
│           └── components/
│               ├── Sidebar.tsx
│               ├── TabBar.tsx
│               ├── TerminalView.tsx  # xterm + pty wiring (manual-tested)
│               └── NewTerminalDialog.tsx
```

**Testable units (TDD):** `shared/types`, `shared/id`, `store`, `persistence`, `ptyManager` (fake spawner), `TabBar`, `Sidebar`, `NewTerminalDialog`.
**Manual-verified units:** `nodePtySpawner`, `preload`, `main/ipc`, `main/index`, `TerminalView`, `App` — these touch native PTYs, Electron, or `xterm` canvas which unit tests can't exercise reliably.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`, `tailwind.config.js`, `postcss.config.js`
- Create: `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/index.css`
- Create: `src/main/index.ts` (temporary minimal), `src/preload/index.ts` (temporary minimal)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "terminaltor",
  "version": "0.1.0",
  "description": "Grupisani imenovani terminali za Linux",
  "main": "./out/main/index.js",
  "author": "",
  "license": "MIT",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "rebuild": "electron-rebuild -f -w node-pty",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `electron.vite.config.ts`**

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: { resolve: { alias: sharedAlias }, plugins: [externalizeDepsPlugin()] },
  preload: { resolve: { alias: sharedAlias }, plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: sharedAlias },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [react()]
  }
})
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "vitest.setup.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts` and `vitest.setup.ts`**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'] }
})
```

```ts
// vitest.setup.ts
import '@testing-library/jest-dom'
```

- [ ] **Step 5: Create Tailwind config files**

```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: []
}
```

```js
// postcss.config.js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

- [ ] **Step 6: Create renderer entry files**

```html
<!-- src/renderer/index.html -->
<!doctype html>
<html lang="sr">
  <head><meta charset="UTF-8" /><title>Terminaltor</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/renderer/src/main.tsx
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// NOTE: no React.StrictMode — TerminalView manages imperative PTY/xterm resources
// and StrictMode's double-mount would spawn then kill shells in dev.
createRoot(document.getElementById('root')!).render(<App />)
```

```tsx
// src/renderer/src/App.tsx (temporary placeholder, replaced in Task 13)
export default function App() {
  return <div className="p-4 text-gray-200 bg-gray-900 h-screen">Terminaltor — scaffolding OK</div>
}
```

```css
/* src/renderer/src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
html, body, #root { height: 100%; margin: 0; }
body { font-family: ui-sans-serif, system-ui, sans-serif; }
```

- [ ] **Step 7: Create temporary main + preload (replaced in Tasks 7–8)**

```ts
// src/main/index.ts (temporary)
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow() {
  const win = new BrowserWindow({ width: 1200, height: 800, show: false })
  win.on('ready-to-show', () => win.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}
app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

```ts
// src/preload/index.ts (temporary)
export {}
```

- [ ] **Step 8: Install dependencies and rebuild native module**

Run: `npm install`
Then: `npm run rebuild`
Expected: install completes; `electron-rebuild` rebuilds `node-pty` for Electron ABI without error.

- [ ] **Step 9: Smoke-verify the test runner**

Run: `npm test`
Expected: Vitest runs and reports "No test files found" (exit 0) — confirms config is valid. (Real tests arrive in Task 2.)

- [ ] **Step 10: Smoke-verify the app boots (manual)**

Run: `npm run dev`
Expected: an Electron window opens showing "Terminaltor — scaffolding OK". Close it.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + Vite + React + Tailwind + Vitest"
```

---

## Task 2: Shared types, id, and contract files

**Files:**
- Create: `src/shared/types.ts`, `src/shared/id.ts`, `src/shared/pty.ts`, `src/shared/ipc.ts`, `src/shared/api.ts`
- Test: `src/shared/types.test.ts`, `src/shared/id.test.ts`

- [ ] **Step 1: Write failing test for `types` and `id`**

```ts
// src/shared/types.test.ts
import { describe, it, expect } from 'vitest'
import { createWorkspace } from './types'

describe('createWorkspace', () => {
  it('returns an empty workspace with a groups array', () => {
    const ws = createWorkspace()
    expect(ws).toEqual({ groups: [] })
  })
})
```

```ts
// src/shared/id.test.ts
import { describe, it, expect } from 'vitest'
import { createId } from './id'

describe('createId', () => {
  it('returns a non-empty string', () => {
    expect(typeof createId()).toBe('string')
    expect(createId().length).toBeGreaterThan(0)
  })
  it('returns unique values', () => {
    expect(createId()).not.toBe(createId())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./types` / `./id`.

- [ ] **Step 3: Implement `types.ts` and `id.ts`**

```ts
// src/shared/types.ts
export interface Terminal {
  id: string
  name: string
  cwd: string            // '' means: resolve to home dir at spawn time
  startupCommand?: string
  shell?: string         // '' / undefined means: $SHELL || /bin/bash
}

export interface Group {
  id: string
  name: string
  collapsed: boolean
  terminals: Terminal[]
}

export interface Workspace {
  groups: Group[]
}

export function createWorkspace(): Workspace {
  return { groups: [] }
}
```

```ts
// src/shared/id.ts
export function createId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
```

- [ ] **Step 4: Implement the contract files (no tests — pure declarations)**

```ts
// src/shared/pty.ts
export interface PtyCreateOptions {
  id: string
  cwd: string
  shell: string
  cols: number
  rows: number
  startupCommand?: string
}

export interface PtyHandle {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (exitCode: number) => void): void
}

export type PtySpawner = (opts: {
  shell: string
  cwd: string
  cols: number
  rows: number
}) => PtyHandle
```

```ts
// src/shared/ipc.ts
export const IPC = {
  workspaceLoad: 'workspace:load',
  workspaceSave: 'workspace:save',
  ptyCreate: 'pty:create',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit'
} as const
```

```ts
// src/shared/api.ts
import type { Workspace } from './types'
import type { PtyCreateOptions } from './pty'

export interface TerminaltorApi {
  loadWorkspace(): Promise<Workspace>
  saveWorkspace(ws: Workspace): void
  createPty(opts: PtyCreateOptions): void
  writePty(id: string, data: string): void
  resizePty(id: string, cols: number, rows: number): void
  killPty(id: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (id: string, code: number) => void): () => void
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: shared types, id generator, and IPC/PTY contracts"
```

---

## Task 3: Store — pure AppState reducers + selectors

**Files:**
- Create: `src/renderer/src/store.ts`
- Test: `src/renderer/src/store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/src/store.test.ts
import { describe, it, expect } from 'vitest'
import {
  createInitialState, addGroup, renameGroup, toggleGroupCollapsed, deleteGroup,
  addTerminal, removeTerminal, setActiveGroup, setActiveTerminal,
  getActiveGroup, getActiveTerminal, allTerminals
} from './store'

describe('store reducers', () => {
  it('addGroup adds and activates the group', () => {
    const s = addGroup(createInitialState(), 'feature-auth')
    expect(s.workspace.groups).toHaveLength(1)
    expect(s.workspace.groups[0].name).toBe('feature-auth')
    expect(s.activeGroupId).toBe(s.workspace.groups[0].id)
    expect(s.activeTerminalId).toBeNull()
  })

  it('renameGroup changes the name', () => {
    let s = addGroup(createInitialState(), 'old')
    const id = s.workspace.groups[0].id
    s = renameGroup(s, id, 'new')
    expect(s.workspace.groups[0].name).toBe('new')
  })

  it('toggleGroupCollapsed flips collapsed', () => {
    let s = addGroup(createInitialState(), 'g')
    const id = s.workspace.groups[0].id
    s = toggleGroupCollapsed(s, id)
    expect(s.workspace.groups[0].collapsed).toBe(true)
  })

  it('addTerminal appends and activates it', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'claude', cwd: '/tmp', startupCommand: 'claude' })
    const t = s.workspace.groups[0].terminals[0]
    expect(t.name).toBe('claude')
    expect(t.cwd).toBe('/tmp')
    expect(t.startupCommand).toBe('claude')
    expect(s.activeTerminalId).toBe(t.id)
  })

  it('removeTerminal selects a sibling', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'a', cwd: '' })
    s = addTerminal(s, gid, { name: 'b', cwd: '' })
    const aId = s.workspace.groups[0].terminals[0].id
    const bId = s.workspace.groups[0].terminals[1].id
    s = setActiveTerminal(s, bId)
    s = removeTerminal(s, bId)
    expect(s.workspace.groups[0].terminals).toHaveLength(1)
    expect(s.activeTerminalId).toBe(aId)
  })

  it('deleteGroup removes it and re-selects', () => {
    let s = addGroup(addGroup(createInitialState(), 'g1'), 'g2')
    const g1 = s.workspace.groups[0].id
    const g2 = s.workspace.groups[1].id
    s = deleteGroup(s, g2)
    expect(s.workspace.groups).toHaveLength(1)
    expect(s.activeGroupId).toBe(g1)
  })

  it('selectors return active entities', () => {
    let s = addGroup(createInitialState(), 'g')
    const gid = s.workspace.groups[0].id
    s = addTerminal(s, gid, { name: 'x', cwd: '' })
    expect(getActiveGroup(s)?.id).toBe(gid)
    expect(getActiveTerminal(s)?.name).toBe('x')
    expect(allTerminals(s)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Implement `store.ts`**

```ts
// src/renderer/src/store.ts
import { Workspace, Group, Terminal, createWorkspace } from '@shared/types'
import { createId } from '@shared/id'

export interface AppState {
  workspace: Workspace
  activeGroupId: string | null
  activeTerminalId: string | null
}

export function createInitialState(ws: Workspace = createWorkspace()): AppState {
  const firstGroup = ws.groups[0] ?? null
  const firstTerm = firstGroup?.terminals[0] ?? null
  return {
    workspace: ws,
    activeGroupId: firstGroup?.id ?? null,
    activeTerminalId: firstTerm?.id ?? null
  }
}

export function addGroup(state: AppState, name: string): AppState {
  const group: Group = { id: createId(), name, collapsed: false, terminals: [] }
  return {
    ...state,
    workspace: { groups: [...state.workspace.groups, group] },
    activeGroupId: group.id,
    activeTerminalId: null
  }
}

export function renameGroup(state: AppState, groupId: string, name: string): AppState {
  return {
    ...state,
    workspace: { groups: state.workspace.groups.map(g => g.id === groupId ? { ...g, name } : g) }
  }
}

export function toggleGroupCollapsed(state: AppState, groupId: string): AppState {
  return {
    ...state,
    workspace: { groups: state.workspace.groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g) }
  }
}

export function deleteGroup(state: AppState, groupId: string): AppState {
  const groups = state.workspace.groups.filter(g => g.id !== groupId)
  let { activeGroupId, activeTerminalId } = state
  if (activeGroupId === groupId) {
    const ng = groups[0] ?? null
    activeGroupId = ng?.id ?? null
    activeTerminalId = ng?.terminals[0]?.id ?? null
  }
  return { ...state, workspace: { groups }, activeGroupId, activeTerminalId }
}

export function addTerminal(
  state: AppState,
  groupId: string,
  input: { name: string; cwd: string; startupCommand?: string; shell?: string }
): AppState {
  const term: Terminal = {
    id: createId(),
    name: input.name,
    cwd: input.cwd,
    startupCommand: input.startupCommand?.trim() ? input.startupCommand : undefined,
    shell: input.shell?.trim() ? input.shell : undefined
  }
  const groups = state.workspace.groups.map(g =>
    g.id === groupId ? { ...g, terminals: [...g.terminals, term] } : g)
  return { ...state, workspace: { groups }, activeGroupId: groupId, activeTerminalId: term.id }
}

export function removeTerminal(state: AppState, terminalId: string): AppState {
  let activeTerminalId = state.activeTerminalId
  const groups = state.workspace.groups.map(g => {
    const idx = g.terminals.findIndex(t => t.id === terminalId)
    if (idx === -1) return g
    const terminals = g.terminals.filter(t => t.id !== terminalId)
    if (activeTerminalId === terminalId) {
      const next = terminals[idx] ?? terminals[idx - 1] ?? null
      activeTerminalId = next?.id ?? null
    }
    return { ...g, terminals }
  })
  return { ...state, workspace: { groups }, activeTerminalId }
}

export function setActiveGroup(state: AppState, groupId: string): AppState {
  const group = state.workspace.groups.find(g => g.id === groupId)
  return { ...state, activeGroupId: groupId, activeTerminalId: group?.terminals[0]?.id ?? null }
}

export function setActiveTerminal(state: AppState, terminalId: string): AppState {
  const group = state.workspace.groups.find(g => g.terminals.some(t => t.id === terminalId))
  return { ...state, activeTerminalId: terminalId, activeGroupId: group?.id ?? state.activeGroupId }
}

export const getActiveGroup = (s: AppState): Group | null =>
  s.workspace.groups.find(g => g.id === s.activeGroupId) ?? null

export const getActiveTerminal = (s: AppState): Terminal | null => {
  for (const g of s.workspace.groups) {
    const t = g.terminals.find(t => t.id === s.activeTerminalId)
    if (t) return t
  }
  return null
}

export const allTerminals = (s: AppState): Terminal[] =>
  s.workspace.groups.flatMap(g => g.terminals)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all store tests + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pure store reducers and selectors with tests"
```

---

## Task 4: Persistence — load / write / debounced save

**Files:**
- Create: `src/main/persistence.ts`
- Test: `src/main/persistence.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/main/persistence.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadWorkspace, writeWorkspace, createDebouncedSaver } from './persistence'
import { createWorkspace } from '@shared/types'

const tmpFile = () => join(tmpdir(), `terminaltor-test-${Math.random().toString(36).slice(2)}.json`)

describe('persistence', () => {
  it('write then load round-trips a workspace', async () => {
    const path = tmpFile()
    const ws = { groups: [{ id: 'g', name: 'G', collapsed: false, terminals: [] }] }
    await writeWorkspace(path, ws)
    expect(await loadWorkspace(path)).toEqual(ws)
    await fs.rm(path, { force: true })
  })

  it('load returns empty workspace when file is missing', async () => {
    expect(await loadWorkspace(tmpFile())).toEqual(createWorkspace())
  })

  it('load returns empty workspace when file is corrupt', async () => {
    const path = tmpFile()
    await fs.writeFile(path, 'not json', 'utf8')
    expect(await loadWorkspace(path)).toEqual(createWorkspace())
    await fs.rm(path, { force: true })
  })

  describe('debounced saver', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('coalesces rapid saves into one write', async () => {
      const path = tmpFile()
      const saver = createDebouncedSaver(path, 300)
      saver.save({ groups: [{ id: '1', name: 'a', collapsed: false, terminals: [] }] })
      saver.save({ groups: [{ id: '2', name: 'b', collapsed: false, terminals: [] }] })
      vi.advanceTimersByTime(300)
      await saver.flushNow()
      const loaded = await loadWorkspace(path)
      expect(loaded.groups[0].id).toBe('2')
      await fs.rm(path, { force: true })
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./persistence`.

- [ ] **Step 3: Implement `persistence.ts`**

```ts
// src/main/persistence.ts
import { promises as fs } from 'fs'
import { Workspace, createWorkspace } from '@shared/types'

export async function loadWorkspace(path: string): Promise<Workspace> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.groups)) return parsed as Workspace
    return createWorkspace()
  } catch {
    return createWorkspace()
  }
}

export async function writeWorkspace(path: string, ws: Workspace): Promise<void> {
  await fs.writeFile(path, JSON.stringify(ws, null, 2), 'utf8')
}

export function createDebouncedSaver(path: string, delayMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Workspace | null = null

  const flush = async () => {
    if (!pending) return
    const ws = pending
    pending = null
    try {
      await writeWorkspace(path, ws)
    } catch (err) {
      console.error('[terminaltor] failed to save workspace:', err)
    }
  }

  return {
    save(ws: Workspace) {
      pending = ws
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; void flush() }, delayMs)
    },
    async flushNow() {
      if (timer) { clearTimeout(timer); timer = null }
      await flush()
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: workspace persistence with debounced save"
```

---

## Task 5: PtyManager (dependency-injected spawner)

**Files:**
- Create: `src/main/ptyManager.ts`
- Test: `src/main/ptyManager.test.ts`

- [ ] **Step 1: Write failing tests with a fake spawner**

```ts
// src/main/ptyManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PtyManager } from './ptyManager'
import type { PtySpawner, PtyHandle } from '@shared/pty'

function makeFake() {
  const created: any[] = []
  const spawner: PtySpawner = (opts) => {
    let dataCb = (_d: string) => {}
    let exitCb = (_c: number) => {}
    const handle: PtyHandle & { opts: any; written: string[]; resized: any; killed: boolean; emitData: (d: string) => void; emitExit: (c: number) => void } = {
      opts, written: [], resized: null, killed: false,
      write: (d) => handle.written.push(d),
      resize: (c, r) => { handle.resized = { c, r } },
      kill: () => { handle.killed = true },
      onData: (cb) => { dataCb = cb },
      onExit: (cb) => { exitCb = cb },
      emitData: (d) => dataCb(d),
      emitExit: (c) => exitCb(c)
    }
    created.push(handle)
    return handle
  }
  return { spawner, created }
}

describe('PtyManager', () => {
  it('creates one handle per id and passes spawn options', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '/tmp', shell: '/bin/bash', cols: 80, rows: 24 })
    expect(created).toHaveLength(1)
    expect(created[0].opts).toMatchObject({ cwd: '/tmp', shell: '/bin/bash', cols: 80, rows: 24 })
  })

  it('ignores a duplicate create for the same id', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    expect(created).toHaveLength(1)
  })

  it('writes the startup command followed by CR', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24, startupCommand: 'claude' })
    expect(created[0].written).toEqual(['claude\r'])
  })

  it('forwards data events with the terminal id', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    const onData = vi.fn()
    m.onData(onData)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    created[0].emitData('hello')
    expect(onData).toHaveBeenCalledWith('t1', 'hello')
  })

  it('write/resize/kill route to the right handle', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    m.write('t1', 'ls\n')
    m.resize('t1', 100, 40)
    m.kill('t1')
    expect(created[0].written).toContain('ls\n')
    expect(created[0].resized).toEqual({ c: 100, r: 40 })
    expect(created[0].killed).toBe(true)
    expect(m.has('t1')).toBe(false)
  })

  it('removes the handle on exit and emits exit', () => {
    const { spawner, created } = makeFake()
    const m = new PtyManager(spawner)
    const onExit = vi.fn()
    m.onExit(onExit)
    m.create({ id: 't1', cwd: '', shell: '', cols: 80, rows: 24 })
    created[0].emitExit(0)
    expect(onExit).toHaveBeenCalledWith('t1', 0)
    expect(m.has('t1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./ptyManager`.

- [ ] **Step 3: Implement `ptyManager.ts`**

```ts
// src/main/ptyManager.ts
import type { PtyHandle, PtySpawner, PtyCreateOptions } from '@shared/pty'

export class PtyManager {
  private handles = new Map<string, PtyHandle>()
  private dataCb: (id: string, data: string) => void = () => {}
  private exitCb: (id: string, code: number) => void = () => {}

  constructor(private spawn: PtySpawner) {}

  onData(cb: (id: string, data: string) => void): void { this.dataCb = cb }
  onExit(cb: (id: string, code: number) => void): void { this.exitCb = cb }

  create(opts: PtyCreateOptions): void {
    if (this.handles.has(opts.id)) return
    const handle = this.spawn({ shell: opts.shell, cwd: opts.cwd, cols: opts.cols, rows: opts.rows })
    handle.onData((data) => this.dataCb(opts.id, data))
    handle.onExit((code) => { this.exitCb(opts.id, code); this.handles.delete(opts.id) })
    this.handles.set(opts.id, handle)
    if (opts.startupCommand && opts.startupCommand.trim()) {
      handle.write(opts.startupCommand + '\r')
    }
  }

  write(id: string, data: string): void { this.handles.get(id)?.write(data) }
  resize(id: string, cols: number, rows: number): void { this.handles.get(id)?.resize(cols, rows) }
  kill(id: string): void {
    const h = this.handles.get(id)
    if (h) { h.kill(); this.handles.delete(id) }
  }
  has(id: string): boolean { return this.handles.has(id) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: PtyManager with injected spawner and tests"
```

---

## Task 6: Real node-pty spawner

**Files:**
- Create: `src/main/nodePtySpawner.ts`

Not unit-tested: `node-pty` is a native module rebuilt for Electron; importing it under Vitest (plain Node) would crash on ABI mismatch. It is exercised by the manual app run in Task 8.

- [ ] **Step 1: Implement `nodePtySpawner.ts`**

```ts
// src/main/nodePtySpawner.ts
import * as os from 'os'
import * as pty from 'node-pty'
import type { PtySpawner, PtyHandle } from '@shared/pty'

export const nodePtySpawner: PtySpawner = ({ shell, cwd, cols, rows }) => {
  const resolvedShell = shell || process.env.SHELL || '/bin/bash'
  const resolvedCwd = cwd || os.homedir()
  const proc = pty.spawn(resolvedShell, [], {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: resolvedCwd,
    env: process.env as Record<string, string>
  })

  const handle: PtyHandle = {
    write: (d) => proc.write(d),
    resize: (c, r) => { try { proc.resize(c, r) } catch { /* pty may have exited */ } },
    kill: () => { try { proc.kill() } catch { /* already gone */ } },
    onData: (cb) => { proc.onData(cb) },
    onExit: (cb) => { proc.onExit(({ exitCode }) => cb(exitCode)) }
  }
  return handle
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: real node-pty spawner"
```

---

## Task 7: Preload bridge + renderer typing

**Files:**
- Modify: `src/preload/index.ts` (replace temporary)
- Create: `src/renderer/src/global.d.ts`

- [ ] **Step 1: Implement preload `index.ts`**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { TerminaltorApi } from '../shared/api'
import type { Workspace } from '../shared/types'
import type { PtyCreateOptions } from '../shared/pty'

const api: TerminaltorApi = {
  loadWorkspace: () => ipcRenderer.invoke(IPC.workspaceLoad) as Promise<Workspace>,
  saveWorkspace: (ws: Workspace) => ipcRenderer.send(IPC.workspaceSave, ws),
  createPty: (opts: PtyCreateOptions) => ipcRenderer.send(IPC.ptyCreate, opts),
  writePty: (id, data) => ipcRenderer.send(IPC.ptyInput, { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, { id, cols, rows }),
  killPty: (id) => ipcRenderer.send(IPC.ptyKill, { id }),
  onPtyData: (cb) => {
    const listener = (_e: unknown, p: { id: string; data: string }) => cb(p.id, p.data)
    ipcRenderer.on(IPC.ptyData, listener)
    return () => ipcRenderer.removeListener(IPC.ptyData, listener)
  },
  onPtyExit: (cb) => {
    const listener = (_e: unknown, p: { id: string; code: number }) => cb(p.id, p.code)
    ipcRenderer.on(IPC.ptyExit, listener)
    return () => ipcRenderer.removeListener(IPC.ptyExit, listener)
  }
}

contextBridge.exposeInMainWorld('terminaltor', api)
```

- [ ] **Step 2: Implement renderer global typing**

```ts
// src/renderer/src/global.d.ts
import type { TerminaltorApi } from '@shared/api'

declare global {
  interface Window {
    terminaltor: TerminaltorApi
  }
}

export {}
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: secure preload bridge and renderer typing"
```

---

## Task 8: Main process IPC wiring + window

**Files:**
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts` (replace temporary)

- [ ] **Step 1: Implement `ipc.ts`**

```ts
// src/main/ipc.ts
import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { PtyManager } from './ptyManager'
import { loadWorkspace, createDebouncedSaver } from './persistence'
import type { Workspace } from '@shared/types'
import type { PtyCreateOptions } from '@shared/pty'

export function registerIpc(opts: {
  win: BrowserWindow
  ptyManager: PtyManager
  workspacePath: string
}): void {
  const { win, ptyManager, workspacePath } = opts
  const saver = createDebouncedSaver(workspacePath)

  ptyManager.onData((id, data) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ptyData, { id, data })
  })
  ptyManager.onExit((id, code) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ptyExit, { id, code })
  })

  ipcMain.handle(IPC.workspaceLoad, () => loadWorkspace(workspacePath))
  ipcMain.on(IPC.workspaceSave, (_e, ws: Workspace) => saver.save(ws))
  ipcMain.on(IPC.ptyCreate, (_e, o: PtyCreateOptions) => ptyManager.create(o))
  ipcMain.on(IPC.ptyInput, (_e, p: { id: string; data: string }) => ptyManager.write(p.id, p.data))
  ipcMain.on(IPC.ptyResize, (_e, p: { id: string; cols: number; rows: number }) => ptyManager.resize(p.id, p.cols, p.rows))
  ipcMain.on(IPC.ptyKill, (_e, p: { id: string }) => ptyManager.kill(p.id))
}
```

- [ ] **Step 2: Implement `index.ts`**

```ts
// src/main/index.ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { PtyManager } from './ptyManager'
import { nodePtySpawner } from './nodePtySpawner'
import { registerIpc } from './ipc'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#0d1117',
    title: 'Terminaltor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  const ptyManager = new PtyManager(nodePtySpawner)
  registerIpc({
    win,
    ptyManager,
    workspacePath: join(app.getPath('userData'), 'workspace.json')
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

> Note: `sandbox: false` is required so the preload can `require('electron')` while still keeping `contextIsolation: true` and `nodeIntegration: false`.

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Verify the app still boots (manual)**

Run: `npm run dev`
Expected: window opens (still the placeholder App from Task 1). DevTools console shows no errors. Close it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire main-process IPC and window with PTY + persistence"
```

---

## Task 9: TerminalView (xterm + PTY wiring)

**Files:**
- Create: `src/renderer/src/components/TerminalView.tsx`

Manual-verified (xterm renders to a canvas that jsdom can't drive). Logic is kept thin.

- [ ] **Step 1: Implement `TerminalView.tsx`**

```tsx
// src/renderer/src/components/TerminalView.tsx
import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Terminal as TerminalModel } from '@shared/types'

const THEME = { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' }

export function TerminalView({ terminal, active }: { terminal: TerminalModel; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new XTerm({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    xtermRef.current = term
    fitRef.current = fit
    try { fit.fit() } catch { /* host may be hidden */ }

    window.terminaltor.createPty({
      id: terminal.id,
      cwd: terminal.cwd,
      shell: terminal.shell ?? '',
      cols: term.cols || 80,
      rows: term.rows || 24,
      startupCommand: terminal.startupCommand
    })

    const offData = window.terminaltor.onPtyData((id, data) => { if (id === terminal.id) term.write(data) })
    const offExit = window.terminaltor.onPtyExit((id) => {
      if (id === terminal.id) term.write('\r\n\x1b[33m[proces završen]\x1b[0m\r\n')
    })
    const inputDisposable = term.onData((data) => window.terminaltor.writePty(terminal.id, data))

    // Ctrl+Shift+C / Ctrl+Shift+V copy-paste
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.code === 'KeyC') {
        const sel = term.getSelection()
        if (sel) void navigator.clipboard.writeText(sel)
        return false
      }
      if (e.code === 'KeyV') {
        void navigator.clipboard.readText().then((text) => window.terminaltor.writePty(terminal.id, text))
        return false
      }
      return true
    })

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        window.terminaltor.resizePty(terminal.id, term.cols, term.rows)
      } catch { /* hidden */ }
    })
    ro.observe(host)

    return () => {
      offData()
      offExit()
      inputDisposable.dispose()
      ro.disconnect()
      term.dispose()
      window.terminaltor.killPty(terminal.id)
    }
    // Mount-once: PTY lifecycle is tied to this component's lifetime, not to prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When this terminal becomes visible, refit (xterm can't measure while display:none) and focus.
  useEffect(() => {
    if (!active) return
    const term = xtermRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    try {
      fit.fit()
      window.terminaltor.resizePty(terminal.id, term.cols, term.rows)
      term.focus()
    } catch { /* ignore */ }
  }, [active, terminal.id])

  return <div ref={hostRef} className="h-full w-full" />
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: TerminalView binding xterm.js to a PTY"
```

---

## Task 10: TabBar component

**Files:**
- Create: `src/renderer/src/components/TabBar.tsx`
- Test: `src/renderer/src/components/TabBar.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/renderer/src/components/TabBar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'
import type { Terminal } from '@shared/types'

const terms: Terminal[] = [
  { id: 'a', name: 'claude-api', cwd: '' },
  { id: 'b', name: 'tests', cwd: '' }
]

describe('TabBar', () => {
  it('renders a tab per terminal and marks the active one', () => {
    render(<TabBar terminals={terms} activeId="a" onSelect={() => {}} onClose={() => {}} onAdd={() => {}} />)
    expect(screen.getByText('claude-api')).toBeInTheDocument()
    expect(screen.getByText('tests')).toBeInTheDocument()
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('claude-api')
  })

  it('calls onSelect when a tab is clicked', async () => {
    const onSelect = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={onSelect} onClose={() => {}} onAdd={() => {}} />)
    await userEvent.click(screen.getByText('tests'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('calls onClose without selecting when the × is clicked', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={onSelect} onClose={onClose} onAdd={() => {}} />)
    await userEvent.click(screen.getByLabelText('Zatvori tests'))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('calls onAdd when + is clicked', async () => {
    const onAdd = vi.fn()
    render(<TabBar terminals={terms} activeId="a" onSelect={() => {}} onClose={() => {}} onAdd={onAdd} />)
    await userEvent.click(screen.getByLabelText('Novi terminal'))
    expect(onAdd).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./TabBar`.

- [ ] **Step 3: Implement `TabBar.tsx`**

```tsx
// src/renderer/src/components/TabBar.tsx
import type { Terminal } from '@shared/types'

export function TabBar({
  terminals, activeId, onSelect, onClose, onAdd
}: {
  terminals: Terminal[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
}) {
  return (
    <div role="tablist" className="flex items-center gap-1 h-9 px-2 bg-gray-900 border-b border-gray-700 overflow-x-auto">
      {terminals.map((t) => {
        const isActive = t.id === activeId
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.id)}
            className={`group flex items-center gap-2 h-7 px-3 rounded-t text-sm cursor-pointer whitespace-nowrap ${
              isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            <span>{t.name}</span>
            <button
              aria-label={`Zatvori ${t.name}`}
              onClick={(e) => { e.stopPropagation(); onClose(t.id) }}
              className="text-gray-500 hover:text-white"
            >
              ×
            </button>
          </div>
        )
      })}
      <button aria-label="Novi terminal" onClick={onAdd} className="ml-1 px-2 text-gray-400 hover:text-white">+</button>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: TabBar component with tests"
```

---

## Task 11: Sidebar component

**Files:**
- Create: `src/renderer/src/components/Sidebar.tsx`
- Test: `src/renderer/src/components/Sidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/renderer/src/components/Sidebar.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import type { Group } from '@shared/types'

const groups: Group[] = [
  { id: 'g1', name: 'feature-auth', collapsed: false, terminals: [
    { id: 't1', name: 'claude-api', cwd: '' }
  ] },
  { id: 'g2', name: 'devops', collapsed: true, terminals: [
    { id: 't2', name: 'deploy', cwd: '' }
  ] }
]

function noop() {}

describe('Sidebar', () => {
  it('renders groups and the terminals of expanded groups only', () => {
    render(<Sidebar groups={groups} activeTerminalId="t1"
      onSelectTerminal={noop} onToggleGroup={noop} onAddGroup={noop} onAddTerminal={noop} onDeleteGroup={noop} />)
    expect(screen.getByText('feature-auth')).toBeInTheDocument()
    expect(screen.getByText('claude-api')).toBeInTheDocument()  // g1 expanded
    expect(screen.queryByText('deploy')).not.toBeInTheDocument() // g2 collapsed
  })

  it('selects a terminal on click', async () => {
    const onSelectTerminal = vi.fn()
    render(<Sidebar groups={groups} activeTerminalId={null}
      onSelectTerminal={onSelectTerminal} onToggleGroup={noop} onAddGroup={noop} onAddTerminal={noop} onDeleteGroup={noop} />)
    await userEvent.click(screen.getByText('claude-api'))
    expect(onSelectTerminal).toHaveBeenCalledWith('t1')
  })

  it('toggles a group when its caret is clicked', async () => {
    const onToggleGroup = vi.fn()
    render(<Sidebar groups={groups} activeTerminalId={null}
      onSelectTerminal={noop} onToggleGroup={onToggleGroup} onAddGroup={noop} onAddTerminal={noop} onDeleteGroup={noop} />)
    await userEvent.click(screen.getByLabelText('Skupi/raširi feature-auth'))
    expect(onToggleGroup).toHaveBeenCalledWith('g1')
  })

  it('adds a group from the input on Enter', async () => {
    const onAddGroup = vi.fn()
    render(<Sidebar groups={groups} activeTerminalId={null}
      onSelectTerminal={noop} onToggleGroup={noop} onAddGroup={onAddGroup} onAddTerminal={noop} onDeleteGroup={noop} />)
    const input = screen.getByPlaceholderText('Nova grupa…')
    await userEvent.type(input, 'feature-ui{Enter}')
    expect(onAddGroup).toHaveBeenCalledWith('feature-ui')
  })

  it('requests a new terminal for a group', async () => {
    const onAddTerminal = vi.fn()
    render(<Sidebar groups={groups} activeTerminalId={null}
      onSelectTerminal={noop} onToggleGroup={noop} onAddGroup={noop} onAddTerminal={onAddTerminal} onDeleteGroup={noop} />)
    await userEvent.click(screen.getByLabelText('Novi terminal u feature-auth'))
    expect(onAddTerminal).toHaveBeenCalledWith('g1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./Sidebar`.

- [ ] **Step 3: Implement `Sidebar.tsx`**

```tsx
// src/renderer/src/components/Sidebar.tsx
import { useState } from 'react'
import type { Group } from '@shared/types'

export function Sidebar({
  groups, activeTerminalId, onSelectTerminal, onToggleGroup, onAddGroup, onAddTerminal, onDeleteGroup
}: {
  groups: Group[]
  activeTerminalId: string | null
  onSelectTerminal: (id: string) => void
  onToggleGroup: (id: string) => void
  onAddGroup: (name: string) => void
  onAddTerminal: (groupId: string) => void
  onDeleteGroup: (id: string) => void
}) {
  const [draft, setDraft] = useState('')

  const submitGroup = () => {
    const name = draft.trim()
    if (!name) return
    onAddGroup(name)
    setDraft('')
  }

  return (
    <div className="w-60 shrink-0 h-full flex flex-col bg-gray-900 border-r border-gray-700 text-gray-300">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Terminaltor</div>

      <div className="flex-1 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.id} className="select-none">
            <div className="group flex items-center gap-1 px-2 py-1 hover:bg-gray-800">
              <button
                aria-label={`Skupi/raširi ${g.name}`}
                onClick={() => onToggleGroup(g.id)}
                className="w-4 text-gray-500"
              >
                {g.collapsed ? '▸' : '▾'}
              </button>
              <span className="flex-1 truncate text-sm font-medium text-gray-200">{g.name}</span>
              <button
                aria-label={`Novi terminal u ${g.name}`}
                onClick={() => onAddTerminal(g.id)}
                className="opacity-0 group-hover:opacity-100 px-1 text-gray-400 hover:text-white"
              >
                +
              </button>
              <button
                aria-label={`Obriši grupu ${g.name}`}
                onClick={() => onDeleteGroup(g.id)}
                className="opacity-0 group-hover:opacity-100 px-1 text-gray-400 hover:text-red-400"
              >
                ×
              </button>
            </div>
            {!g.collapsed && g.terminals.map((t) => (
              <div
                key={t.id}
                onClick={() => onSelectTerminal(t.id)}
                className={`pl-8 pr-2 py-1 text-sm cursor-pointer truncate ${
                  t.id === activeTerminalId ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800'
                }`}
              >
                {t.name}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="p-2 border-t border-gray-700">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitGroup() }}
          placeholder="Nova grupa…"
          className="w-full px-2 py-1 text-sm rounded bg-gray-800 text-gray-200 placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Sidebar component with tests"
```

---

## Task 12: NewTerminalDialog component

**Files:**
- Create: `src/renderer/src/components/NewTerminalDialog.tsx`
- Test: `src/renderer/src/components/NewTerminalDialog.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/renderer/src/components/NewTerminalDialog.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTerminalDialog } from './NewTerminalDialog'

describe('NewTerminalDialog', () => {
  it('submits name, cwd and startup command', async () => {
    const onCreate = vi.fn()
    render(<NewTerminalDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.type(screen.getByLabelText('Ime'), 'claude-api')
    await userEvent.type(screen.getByLabelText('Radni direktorijum (cwd)'), '/home/me/proj')
    await userEvent.type(screen.getByLabelText('Startup komanda'), 'claude')
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).toHaveBeenCalledWith({ name: 'claude-api', cwd: '/home/me/proj', startupCommand: 'claude' })
  })

  it('does not submit with an empty name', async () => {
    const onCreate = vi.fn()
    render(<NewTerminalDialog onCreate={onCreate} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Kreiraj' }))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(<NewTerminalDialog onCreate={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Otkaži' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./NewTerminalDialog`.

- [ ] **Step 3: Implement `NewTerminalDialog.tsx`**

```tsx
// src/renderer/src/components/NewTerminalDialog.tsx
import { useState } from 'react'

export interface NewTerminalInput {
  name: string
  cwd: string
  startupCommand?: string
}

export function NewTerminalDialog({
  onCreate, onCancel
}: {
  onCreate: (input: NewTerminalInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [startupCommand, setStartupCommand] = useState('')

  const submit = () => {
    const n = name.trim()
    if (!n) return
    onCreate({
      name: n,
      cwd: cwd.trim(),
      startupCommand: startupCommand.trim() || undefined
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-96 rounded-lg bg-gray-800 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold text-gray-100">Novi terminal</h2>

        <label className="block mb-3 text-sm text-gray-300">
          Ime
          <input
            autoFocus
            aria-label="Ime"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            className="mt-1 w-full rounded bg-gray-900 px-2 py-1 text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="block mb-3 text-sm text-gray-300">
          Radni direktorijum (cwd)
          <input
            aria-label="Radni direktorijum (cwd)"
            value={cwd}
            placeholder="~ (home ako prazno)"
            onChange={(e) => setCwd(e.target.value)}
            className="mt-1 w-full rounded bg-gray-900 px-2 py-1 text-gray-100 placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="block mb-4 text-sm text-gray-300">
          Startup komanda
          <input
            aria-label="Startup komanda"
            value={startupCommand}
            placeholder="npr. claude (opciono)"
            onChange={(e) => setStartupCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            className="mt-1 w-full rounded bg-gray-900 px-2 py-1 text-gray-100 placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded px-3 py-1 text-gray-300 hover:bg-gray-700">Otkaži</button>
          <button onClick={submit} className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-500">Kreiraj</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: NewTerminalDialog with tests"
```

---

## Task 13: App composition + IPC glue

**Files:**
- Create: `src/renderer/src/useStore.ts`
- Modify: `src/renderer/src/App.tsx` (replace placeholder)

- [ ] **Step 1: Implement `useStore.ts`**

```ts
// src/renderer/src/useStore.ts
import { useState, useCallback } from 'react'
import { AppState, createInitialState } from './store'

export function useStore() {
  const [state, setState] = useState<AppState>(() => createInitialState())
  const apply = useCallback((fn: (s: AppState) => AppState) => setState((s) => fn(s)), [])
  return { state, setState, apply }
}
```

- [ ] **Step 2: Implement `App.tsx`**

```tsx
// src/renderer/src/App.tsx
import { useEffect, useState } from 'react'
import { useStore } from './useStore'
import {
  createInitialState, addGroup, deleteGroup, toggleGroupCollapsed,
  addTerminal, removeTerminal, setActiveTerminal,
  getActiveGroup, allTerminals
} from './store'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { NewTerminalDialog, NewTerminalInput } from './components/NewTerminalDialog'

export default function App() {
  const { state, setState, apply } = useStore()
  const [dialogGroupId, setDialogGroupId] = useState<string | null>(null)

  // Load persisted workspace once on mount.
  useEffect(() => {
    window.terminaltor.loadWorkspace().then((ws) => setState(createInitialState(ws)))
  }, [setState])

  // Persist whenever the workspace changes (main debounces writes).
  useEffect(() => {
    window.terminaltor.saveWorkspace(state.workspace)
  }, [state.workspace])

  const activeGroup = getActiveGroup(state)
  const terminals = allTerminals(state)

  const openDialog = () => {
    const gid = state.activeGroupId
    if (gid) setDialogGroupId(gid)
  }
  const createTerminal = (input: NewTerminalInput) => {
    if (dialogGroupId) apply((s) => addTerminal(s, dialogGroupId, input))
    setDialogGroupId(null)
  }

  return (
    <div className="flex h-screen text-gray-200 bg-gray-900">
      <Sidebar
        groups={state.workspace.groups}
        activeTerminalId={state.activeTerminalId}
        onSelectTerminal={(id) => apply((s) => setActiveTerminal(s, id))}
        onToggleGroup={(id) => apply((s) => toggleGroupCollapsed(s, id))}
        onAddGroup={(name) => apply((s) => addGroup(s, name))}
        onAddTerminal={(gid) => setDialogGroupId(gid)}
        onDeleteGroup={(id) => apply((s) => deleteGroup(s, id))}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TabBar
          terminals={activeGroup?.terminals ?? []}
          activeId={state.activeTerminalId}
          onSelect={(id) => apply((s) => setActiveTerminal(s, id))}
          onClose={(id) => apply((s) => removeTerminal(s, id))}
          onAdd={openDialog}
        />

        <div className="relative flex-1 bg-[#0d1117]">
          {terminals.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-600">
              Napravi grupu pa terminal da počneš.
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
      </div>

      {dialogGroupId && (
        <NewTerminalDialog onCreate={createTerminal} onCancel={() => setDialogGroupId(null)} />
      )}
    </div>
  )
}
```

> Killing PTYs: closing a terminal or deleting a group removes it from state, which unmounts its `TerminalView`; the unmount cleanup calls `killPty`. No extra wiring needed.

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Full manual E2E (the heart of the app)**

Run: `npm run dev`
Verify each:
- Type a group name in the sidebar input, press Enter → group appears.
- Hover the group, click **+** → dialog opens → name `bash`, leave cwd blank, no startup command → Kreiraj → a terminal tab appears and an interactive shell is live.
- Run `ls`, `pwd`, `vim` (open and `:q`), `htop` (`q` to quit) → full PTY behavior, colors, resize on window resize.
- Add a second terminal with startup command `echo hello-from-startup` → on open the command runs automatically.
- Switch tabs → previously running output continues (e.g., start `ping -c 100 localhost` in one, switch away and back → still counting).
- Close a tab with × → its shell stops; selection moves to a sibling.
- Make a second group, add terminals; switch groups via sidebar → tab set changes.

- [ ] **Step 5: Verify persistence (manual)**

Quit the app, run `npm run dev` again.
Expected: groups and named terminals are restored (fresh shells), each in its saved cwd; terminals with a startup command re-run it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: compose App with sidebar, tabs, terminals, persistence"
```

---

## Task 14: Keyboard shortcuts

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add a global shortcut handler in `App.tsx`**

Add this `useEffect` inside the `App` component, after the persistence effect:

```tsx
  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') {       // new terminal in active group
        e.preventDefault()
        if (state.activeGroupId) setDialogGroupId(state.activeGroupId)
      } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') { // close active terminal
        e.preventDefault()
        if (state.activeTerminalId) apply((s) => removeTerminal(s, state.activeTerminalId!))
      } else if (e.ctrlKey && e.code === 'PageDown') {          // next tab in active group
        e.preventDefault()
        cycleTab(1)
      } else if (e.ctrlKey && e.code === 'PageUp') {            // previous tab
        e.preventDefault()
        cycleTab(-1)
      }
    }
    const cycleTab = (dir: number) => {
      const group = getActiveGroup(state)
      if (!group || group.terminals.length === 0) return
      const idx = group.terminals.findIndex((t) => t.id === state.activeTerminalId)
      const next = group.terminals[(idx + dir + group.terminals.length) % group.terminals.length]
      apply((s) => setActiveTerminal(s, next.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, apply])
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verify shortcuts**

Run: `npm run dev`
- `Ctrl+Shift+T` opens the new-terminal dialog for the active group.
- `Ctrl+Shift+W` closes the active terminal.
- `Ctrl+PageDown` / `Ctrl+PageUp` cycle tabs within the active group.
- In a terminal, select text + `Ctrl+Shift+C` copies; `Ctrl+Shift+V` pastes.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: keyboard shortcuts for tabs and terminals"
```

---

## Task 15: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Terminaltor

Desktop wrapper nad terminalom za Linux: imenovani terminali sa punim PTY-jem,
grupisani u cjeline (sidebar stablo + tabovi) — za organizaciju AI agenata po feature-ima.

## Razvoj

```bash
npm install
npm run rebuild   # rebuild node-pty za Electron ABI
npm run dev       # pokreni aplikaciju
npm test          # unit testovi
```

## Prečice

- `Ctrl+Shift+T` — novi terminal u aktivnoj grupi
- `Ctrl+Shift+W` — zatvori aktivni terminal
- `Ctrl+PageDown` / `Ctrl+PageUp` — sljedeći / prethodni tab
- `Ctrl+Shift+C` / `Ctrl+Shift+V` — kopiraj / nalijepi

## Perzistencija

Struktura (grupe + terminali + cwd + startup komanda) čuva se u
`~/.config/Terminaltor/workspace.json` i obnavlja se na pokretanju sa svježim shell-ovima.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 3: Type-check the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Final manual smoke**

Run: `npm run dev` and re-verify the Task 13 E2E checklist end-to-end once more.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add README and finalize v1"
```

---

## Self-Review Notes (author)

**Spec coverage:** sidebar+tabs layout → Tasks 11/10/13; full PTY → 5/6/9; named terminals + optional cwd + startup command → 12/3/9; grouping → 3/11; persistence of structure with fresh shells → 4/13; copy/paste → 9; shortcuts → 14; error handling (PTY exit message, corrupt-file fallback, save failure log) → 9/4; testing strategy (ptyManager fake, persistence roundtrip, component RTL) → 5/4/10/11/12. Distribution via `npm run dev` → 1/15. All v1 spec items map to a task.

**Out-of-scope (correctly deferred to V2+):** split panes, drag-and-drop, group templates, scrollback persistence, packaging, settings UI, in-terminal search.

**Type consistency:** `TerminaltorApi` (shared/api.ts) is implemented verbatim in preload and consumed in TerminalView/App; `PtyCreateOptions`/`PtySpawner`/`PtyHandle` consistent across ptyManager, nodePtySpawner, preload; store reducer/selector names match their usages in App and tests; IPC channel constants single-sourced in shared/ipc.ts.

**Known intentional choices:** no `React.StrictMode` (imperative PTY lifecycle); all terminals stay mounted (hidden) so shells keep running; default cwd/shell resolved in `nodePtySpawner` (main) since the renderer has no Node env.
```

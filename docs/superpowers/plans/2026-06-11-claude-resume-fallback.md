# Claude Resume Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A restored claude terminal whose pinned session is gone spawns a fresh conversation with a new persisted id instead of dying on `claude --resume <missing-id>`.

**Architecture:** Pre-flight check in the main process (the transcript path is fully known), decision in `TerminalView`'s spawn effect, new id persisted through the existing `setTerminalSessionId` store action via a callback prop threaded App → TerminalPane → TerminalView.

**Tech Stack:** Electron IPC (invoke), React, vitest + @testing-library/react (mocked `window.brain`).

**Spec:** `docs/superpowers/specs/2026-06-11-claude-resume-fallback-design.md`

---

### Task 1: `claudeSessionExists` in main's transcript module

**Files:**
- Modify: `src/main/transcript.ts` (append export)
- Test: `src/main/transcript.test.ts` (append describe block)

- [ ] **Step 1: Write the failing tests**

Append to `src/main/transcript.test.ts` (reuses the existing `mktmp` helper; add `claudeSessionExists` to the existing import from `./transcript`):

```ts
describe('claudeSessionExists', () => {
  it('true when the pinned session file exists', async () => {
    const home = await mktmp()
    const proj = claudeProjectDir(home, '/work/app')
    await fs.mkdir(proj, { recursive: true })
    await fs.writeFile(join(proj, 'sess-1.jsonl'), '{}', 'utf8')
    expect(await claudeSessionExists({ home, cwd: '/work/app', sessionId: 'sess-1' })).toBe(true)
    await fs.rm(home, { recursive: true, force: true })
  })

  it('false when the pinned session file is gone (other sessions do not count)', async () => {
    const home = await mktmp()
    const proj = claudeProjectDir(home, '/work/app')
    await fs.mkdir(proj, { recursive: true })
    await fs.writeFile(join(proj, 'other.jsonl'), '{}', 'utf8')
    expect(await claudeSessionExists({ home, cwd: '/work/app', sessionId: 'sess-1' })).toBe(false)
    await fs.rm(home, { recursive: true, force: true })
  })

  it('without an id: true when the cwd has any session (the --continue target)', async () => {
    const home = await mktmp()
    const proj = claudeProjectDir(home, '/work/app')
    await fs.mkdir(proj, { recursive: true })
    await fs.writeFile(join(proj, 'any.jsonl'), '{}', 'utf8')
    expect(await claudeSessionExists({ home, cwd: '/work/app' })).toBe(true)
    await fs.rm(home, { recursive: true, force: true })
  })

  it('without an id: false when the project dir is empty or missing', async () => {
    const home = await mktmp()
    expect(await claudeSessionExists({ home, cwd: '/work/none' })).toBe(false)
    await fs.rm(home, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/transcript.test.ts`
Expected: FAIL — `claudeSessionExists` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/main/transcript.ts`:

```ts
// Whether the claude conversation a restored terminal would resume still
// exists: the exact <sessionId>.jsonl when an id is pinned, else any session
// in the cwd's project dir (the `--continue` target). Missing → the caller
// falls back to a fresh conversation instead of spawning a doomed resume.
export async function claudeSessionExists(opts: { home?: string; cwd: string; sessionId?: string }): Promise<boolean> {
  const home = opts.home ?? homedir()
  const dir = claudeProjectDir(home, opts.cwd)
  if (opts.sessionId) {
    try { await fs.access(join(dir, `${opts.sessionId}.jsonl`)); return true } catch { return false }
  }
  return (await newestJsonl(dir)) !== null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/transcript.test.ts`
Expected: PASS (all, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/main/transcript.ts src/main/transcript.test.ts
git commit -m "feat(main): claudeSessionExists — does the session a restore would resume still exist"
```

---

### Task 2: IPC plumbing (channel, BrainApi, preload, handler)

**Files:**
- Modify: `src/shared/ipc.ts` (add channel)
- Modify: `src/shared/api.ts` (add method to `BrainApi`)
- Modify: `src/preload/index.ts` (add binding)
- Modify: `src/main/ipc.ts` (add handler)

Pure wiring — no unit test (matches every other invoke channel in the repo); `tsc` and the Task 3 renderer tests cover it.

- [ ] **Step 1: Add the channel to `src/shared/ipc.ts`**

After the `agentCaptureSession: 'agent:captureSession',` line add:

```ts
  claudeSessionExists: 'agent:claudeSessionExists',
```

- [ ] **Step 2: Add the method to `BrainApi` in `src/shared/api.ts`**

After the `resolveTranscript(cwd: string, kind?: string): Promise<string | null>` line add:

```ts
  // Does the claude session a restored terminal would resume still exist?
  // With an id: that exact conversation; without: any session in the cwd.
  claudeSessionExists(cwd: string, sessionId?: string): Promise<boolean>
```

- [ ] **Step 3: Add the preload binding in `src/preload/index.ts`**

After the `captureAgentSession: ...` line add:

```ts
  claudeSessionExists: (cwd, sessionId) =>
    ipcRenderer.invoke(IPC.claudeSessionExists, { cwd, sessionId }) as Promise<boolean>,
```

- [ ] **Step 4: Add the handler in `src/main/ipc.ts`**

Extend the existing `./transcript` import with `claudeSessionExists` (it currently imports `resolveTranscript`), then after the `IPC.reviewResolveTranscript` handler add:

```ts
  ipcMain.handle(IPC.claudeSessionExists, (_e, p: { cwd: string; sessionId?: string }) =>
    claudeSessionExists({ cwd: p.cwd || os.homedir(), sessionId: p.sessionId }))
```

- [ ] **Step 5: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat(ipc): claudeSessionExists invoke channel main↔renderer"
```

---

### Task 3: TerminalView pre-flight + fallback spawn

**Files:**
- Modify: `src/renderer/src/components/TerminalView.tsx`
- Test: `src/renderer/src/components/TerminalView.test.tsx`

- [ ] **Step 1: Update the mock api + the two existing claude-resume tests, add the new failing tests**

In `TerminalView.test.tsx`, add to the `api` object literal:

```ts
  claudeSessionExists: vi.fn(async (): Promise<boolean> => true),
```

and in `beforeEach` (after `vi.clearAllMocks()`), pin the default so a test's
`mockResolvedValue(false)` cannot leak into the next test:

```ts
  api.claudeSessionExists.mockResolvedValue(true)
```

The claude resume spawn becomes async — update the TWO existing claude tests to await it:

```ts
  it('spawns a restored claude terminal with its resume command', async () => {
    render(<TerminalView terminal={term} active resume />)
    await vi.waitFor(() =>
      expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', startupCommand: 'claude --continue' })))
  })
```

```ts
  it('resumes a restored claude terminal by its exact session id', async () => {
    const claude: TerminalModel = { id: 't4', name: 'claude', cwd: '/x', startupCommand: 'claude', kind: 'claude', sessionId: 'sess-4' }
    render(<TerminalView terminal={claude} active resume />)
    await vi.waitFor(() =>
      expect(api.createPty).toHaveBeenCalledWith(expect.objectContaining({ id: 't4', startupCommand: 'claude --resume sess-4' })))
  })
```

Append a new describe block:

```ts
describe('TerminalView claude resume fallback', () => {
  it('falls back to a fresh pinned conversation when the pinned session is gone', async () => {
    api.claudeSessionExists.mockResolvedValue(false)
    const onSessionFallback = vi.fn()
    const claude: TerminalModel = { id: 't6', name: 'claude', cwd: '/x', startupCommand: 'claude', kind: 'claude', sessionId: 'dead-1' }
    render(<TerminalView terminal={claude} active resume onSessionFallback={onSessionFallback} />)
    await vi.waitFor(() => expect(api.createPty).toHaveBeenCalled())
    expect(api.claudeSessionExists).toHaveBeenCalledWith('/x', 'dead-1')
    const cmd = api.createPty.mock.calls[0][0].startupCommand as string
    expect(cmd).toMatch(/^claude --session-id .+/)
    expect(cmd).not.toContain('dead-1')
    const freshId = cmd.replace('claude --session-id ', '')
    expect(onSessionFallback).toHaveBeenCalledWith('t6', freshId)
  })

  it('legacy terminal (no pinned id) with no sessions in the cwd starts a fresh pinned conversation', async () => {
    api.claudeSessionExists.mockResolvedValue(false)
    render(<TerminalView terminal={term} active resume />)
    await vi.waitFor(() => expect(api.createPty).toHaveBeenCalled())
    expect(api.createPty.mock.calls[0][0].startupCommand).toMatch(/^claude --session-id .+/)
  })

  it('treats a failing existence check as a missing session (fresh beats dead)', async () => {
    api.claudeSessionExists.mockRejectedValue(new Error('ipc broke'))
    const claude: TerminalModel = { id: 't7', name: 'claude', cwd: '/x', startupCommand: 'claude', kind: 'claude', sessionId: 'sess-7' }
    render(<TerminalView terminal={claude} active resume />)
    await vi.waitFor(() => expect(api.createPty).toHaveBeenCalled())
    expect(api.createPty.mock.calls[0][0].startupCommand).toMatch(/^claude --session-id .+/)
  })

  it('never consults the check for codex, shells, or fresh mounts', () => {
    const codex: TerminalModel = { id: 't5', name: 'codex', cwd: '/x', startupCommand: 'codex', kind: 'codex', sessionId: 'sess-5' }
    const shell: TerminalModel = { id: 't3', name: 'dev', cwd: '/x', startupCommand: 'npm run dev', kind: 'shell' }
    render(<TerminalView terminal={codex} active resume />)
    render(<TerminalView terminal={shell} active resume />)
    render(<TerminalView terminal={term} active />) // fresh claude mount
    expect(api.claudeSessionExists).not.toHaveBeenCalled()
    expect(api.createPty).toHaveBeenCalledTimes(3) // all three spawned synchronously
  })

  it('does not spawn a PTY when the view unmounts while the check is in flight', async () => {
    let resolveCheck!: (b: boolean) => void
    api.claudeSessionExists.mockImplementation(() => new Promise<boolean>((r) => { resolveCheck = r }))
    const claude: TerminalModel = { id: 't8', name: 'claude', cwd: '/x', startupCommand: 'claude', kind: 'claude', sessionId: 'sess-8' }
    const { unmount } = render(<TerminalView terminal={claude} active resume />)
    unmount()
    resolveCheck(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(api.createPty).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/renderer/src/components/TerminalView.test.tsx`
Expected: the fallback describe FAILS (`claudeSessionExists` never called, command is `claude --resume dead-1`); the two updated resume tests still pass (sync spawn satisfies waitFor immediately).

- [ ] **Step 3: Implement the async pre-flight in `TerminalView.tsx`**

Extend the imports:

```ts
import { agentResumeCommand, agentLaunchCommand } from '../agents'
import { createId } from '@shared/id'
```

Add the prop (mirroring `onOpenFile`'s ref pattern so the async callback never goes stale):

```ts
export function TerminalView({ terminal, active, resume, onOpenFile, onSessionFallback }: {
  terminal: TerminalModel
  active: boolean
  resume?: boolean
  onOpenFile?: (path: string) => void
  // A restore found the pinned claude session gone and spawned a fresh
  // conversation instead — `sessionId` is the new pin to persist.
  onSessionFallback?: (terminalId: string, sessionId: string) => void
}) {
```

```ts
  const onSessionFallbackRef = useRef(onSessionFallback)
  useEffect(() => { onSessionFallbackRef.current = onSessionFallback })
```

In the mount effect, replace the single `window.brain.createPty({...})` call with:

```ts
    const spawn = (startupCommand?: string) => window.brain.createPty({
      id: terminal.id,
      cwd: terminal.cwd,
      shell: terminal.shell ?? '',
      cols: term.cols || 80,
      rows: term.rows || 24,
      startupCommand
    })
    let spawnCancelled = false
    if (resume && terminal.kind === 'claude') {
      // The pinned session can be gone (~/.claude wiped, conversation expired):
      // `claude --resume <id>` prints "No conversation found" and exits, leaving
      // a dead terminal. Check first; when it's missing, start a fresh
      // conversation under a NEW pinned id and persist it. A failed check
      // counts as missing — fresh beats dead.
      void window.brain.claudeSessionExists(terminal.cwd, terminal.sessionId)
        .catch(() => false)
        .then((exists) => {
          if (spawnCancelled) return
          if (exists) {
            spawn(agentResumeCommand({ kind: terminal.kind, sessionId: terminal.sessionId }) ?? terminal.startupCommand)
            return
          }
          const freshId = createId()
          term.write('\x1b[33m[previous session not found — starting fresh]\x1b[0m\r\n')
          onSessionFallbackRef.current?.(terminal.id, freshId)
          spawn(agentLaunchCommand('claude', freshId))
        })
    } else {
      spawn((resume ? agentResumeCommand({ kind: terminal.kind, sessionId: terminal.sessionId }) : undefined) ?? terminal.startupCommand)
    }
```

In the effect's cleanup function add (next to the existing listener disposals):

```ts
      spawnCancelled = true
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/components/TerminalView.test.tsx`
Expected: PASS (all, including the untouched codex/shell/fresh tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TerminalView.tsx src/renderer/src/components/TerminalView.test.tsx
git commit -m "feat(terminal): restored claude falls back to a fresh pinned session when the old one is gone"
```

---

### Task 4: Thread `onSessionFallback` to the store (TerminalPane + App)

**Files:**
- Modify: `src/renderer/src/components/TerminalPane.tsx` (forward prop)
- Modify: `src/renderer/src/App.tsx` (persist via `setTerminalSessionId`)

Glue only: the fallback firing is covered by Task 3's tests and
`setTerminalSessionId` by the store tests; this task wires them together
(typecheck-verified).

- [ ] **Step 1: Forward the prop in `TerminalPane.tsx`**

Add to the destructured props and the type:

```ts
  onSessionFallback?: (terminalId: string, sessionId: string) => void
```

and pass it through where `TerminalView` is rendered:

```tsx
          <TerminalView terminal={terminal} active={active} resume={resume} onOpenFile={onOpenFile} onSessionFallback={onSessionFallback} />
```

- [ ] **Step 2: Persist in `App.tsx`**

On the `<TerminalPane …>` element (next to `onOpenFile`):

```tsx
                onSessionFallback={(id, sid) => apply((s) => setTerminalSessionId(s, id, sid))}
```

(`setTerminalSessionId` is already imported in App.tsx.)

- [ ] **Step 3: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/TerminalPane.tsx src/renderer/src/App.tsx
git commit -m "feat(terminal): persist the fallback session id so the next restart resumes it"
```

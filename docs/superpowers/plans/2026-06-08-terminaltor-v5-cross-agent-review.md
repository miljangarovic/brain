# Cross-agent Review (V5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodati svakom terminalu „Review" akciju koja pokreće *drugi* agent (Claude↔Codex) da iskritikuje artefakt (spec `.md` ili `git diff`), uz file-handoff petlju kroz N iteracija i fajlovima-vođen status (spinner / žuto).

**Architecture:** Review B se spawnuje kao novi terminal u istom feature-u, sa agentom pokrenutim preko `startupCommand = <agent> '<prompt>'` (prompt kao CLI argument). B upiše kritiku u `review-N.md` *van projekta* (`<userData>/reviews/<originId>/`). Relay nazad u implementatora A je `writePty(originId, prompt + '\r')` (injekcija u već pokrenuti agent). Status se ne struže iz PTY-ja nego se izvodi iz `fs.watch` nad review/spec fajlom. Sve „odluke" (prompt-ovi, putanje, status-mapiranje, selektori) su čiste funkcije sa testovima; Electron IPC i React glue su tanki.

**Tech Stack:** Electron + electron-vite, React 18, TypeScript, node-pty, xterm, Vitest + Testing Library. Stil: dependency-injection (kao `PtyManager(spawn)`), čiste reducer funkcije u `store.ts`, fs testovi nad `os.tmpdir()` (kao `persistence.test.ts`).

---

## File Structure

**Nove datoteke:**
- `src/renderer/src/review/prompt.ts` — čisti builderi prompt-ova + `shellSingleQuote`/`buildReviewerCommand`.
- `src/renderer/src/review/prompt.test.ts`
- `src/renderer/src/review/status.ts` — čisto mapiranje `ReviewStatus → DotKind`.
- `src/renderer/src/review/status.test.ts`
- `src/renderer/src/review/useReview.ts` — React hook: orkestracija (store + IPC + watch-evi). Glue.
- `src/main/reviewFs.ts` — `pickNewest`, `scanMarkdown`, `suggestSpec`, `reviewDirFor`, `reviewFilePath`, `resolveReviewPaths`.
- `src/main/reviewFs.test.ts`
- `src/main/reviewWatcher.ts` — debounced watcher sa injektovanim `watchImpl` (kao spawner DI).
- `src/main/reviewWatcher.test.ts`
- `src/renderer/src/components/ReviewDialog.tsx`
- `src/renderer/src/components/ReviewDialog.test.tsx`
- `src/renderer/src/components/ReviewStatusDot.tsx` (+ `SpinnerIcon` u `icons.tsx`).

**Izmijenjene datoteke:**
- `src/shared/types.ts` — `ReviewKind`, `ReviewLink`, `ReviewStatus`, `Terminal.review?`.
- `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts` — novi IPC kanali.
- `src/renderer/src/store.ts` + `store.test.ts` — `addTerminal` prima `review?`, `setReviewRound`, `findReviewerFor`, `featureIdOfTerminal`, `getTerminalById`.
- `src/renderer/src/App.tsx` — `reviewStatus` state, `useReview`, `onFsChanged`, prop-ovi.
- `src/renderer/src/components/Sidebar.tsx` + `TabBar.tsx` — Review hover-dugme, status-dot, relay-dugmad.
- `src/renderer/src/components/icons.tsx` — `SpinnerIcon`, `ReviewIcon`.

**Napomena o ulaznoj tački:** repo ima `components/ContextMenu.tsx` (`MenuItem { label, onSelect }`), već korišćen za desni-klik na grupu. Za Review koristi **baš njega** (desni klik na terminal → stavke „Review ▸ Claude" / „Review ▸ Codex"), što odgovara spec-u (§9). Plan ispod nudi i hover-dugme kao alternativu; biraj context-meni kad je dostupan. Oba samo otvaraju `ReviewDialog` (sa predizabranim reviewer-om).

---

## FAZA 1 — Model + prompt-ovi (čisto, bez UI)

### Task 1: Tipovi review-a

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Dodaj tipove i `Terminal.review`**

U `src/shared/types.ts`, ispod `TerminalKind` dodaj:

```ts
export type ReviewKind = 'spec' | 'impl'

export interface ReviewLink {
  originTerminalId: string   // A — implementer kojeg ovaj terminal recenzira
  reviewKind: ReviewKind
  specPath?: string          // apsolutna putanja artefakta (samo 'spec')
  reviewDir: string          // apsolutni dir za review-N.md (van projekta)
  round: number              // tekuća runda (1-based)
}

export type ReviewStatus = 'reviewing' | 'review-ready' | 'applying' | 'iteration-done'
```

U `interface Terminal` dodaj polje (na kraj):

```ts
  review?: ReviewLink        // prisutno samo na reviewer terminalu (B)
```

- [ ] **Step 2: Verifikuj typecheck**

Run: `npm run typecheck`
Expected: PASS (nema grešaka).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): ReviewLink/ReviewStatus + Terminal.review"
```

---

### Task 2: Čisti prompt builderi

**Files:**
- Create: `src/renderer/src/review/prompt.ts`
- Test: `src/renderer/src/review/prompt.test.ts`

- [ ] **Step 1: Napiši padajuće testove**

Kreiraj `src/renderer/src/review/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  shellSingleQuote, buildReviewerCommand,
  reviewerPrompt, relayToOriginPrompt, reReviewPrompt
} from './prompt'

describe('shellSingleQuote', () => {
  it('wraps in single quotes', () => {
    expect(shellSingleQuote('abc')).toBe(`'abc'`)
  })
  it('escapes embedded single quotes', () => {
    expect(shellSingleQuote("a'b")).toBe(`'a'\\''b'`)
  })
})

describe('buildReviewerCommand', () => {
  it('joins agent command with quoted prompt', () => {
    expect(buildReviewerCommand('claude', 'hi')).toBe(`claude 'hi'`)
  })
})

describe('reviewerPrompt', () => {
  it('spec: references spec path, review file and intent', () => {
    const p = reviewerPrompt({ kind: 'spec', specPath: '/a/spec.md', reviewFile: '/r/review-1.md', intent: 'auth flow' })
    expect(p).toContain('/a/spec.md')
    expect(p).toContain('/r/review-1.md')
    expect(p).toContain('auth flow')
    expect(p).toContain('UPIŠI')
  })
  it('spec without intent uses fallback wording', () => {
    const p = reviewerPrompt({ kind: 'spec', specPath: '/a/spec.md', reviewFile: '/r/review-1.md' })
    expect(p).toContain('izvedi iz')
  })
  it('impl: references git diff and review file, not a spec path', () => {
    const p = reviewerPrompt({ kind: 'impl', reviewFile: '/r/review-1.md' })
    expect(p).toContain('git diff')
    expect(p).toContain('/r/review-1.md')
  })
})

describe('relayToOriginPrompt', () => {
  it('spec: single line pointing at review file + spec path', () => {
    const p = relayToOriginPrompt({ kind: 'spec', reviewFile: '/r/review-1.md', specPath: '/a/spec.md' })
    expect(p).toContain('/r/review-1.md')
    expect(p).toContain('/a/spec.md')
    expect(p).not.toContain('\n')
  })
  it('impl: single line, mentions not to commit', () => {
    const p = relayToOriginPrompt({ kind: 'impl', reviewFile: '/r/review-1.md' })
    expect(p).toContain('/r/review-1.md')
    expect(p).toContain('commit')
    expect(p).not.toContain('\n')
  })
})

describe('reReviewPrompt', () => {
  it('spec: single line, new review file', () => {
    const p = reReviewPrompt({ kind: 'spec', specPath: '/a/spec.md', reviewFile: '/r/review-2.md' })
    expect(p).toContain('/r/review-2.md')
    expect(p).toContain('/a/spec.md')
    expect(p).not.toContain('\n')
  })
})
```

- [ ] **Step 2: Pokreni testove (treba da padnu)**

Run: `npx vitest run src/renderer/src/review/prompt.test.ts`
Expected: FAIL — `Cannot find module './prompt'`.

- [ ] **Step 3: Implementiraj `prompt.ts`**

Kreiraj `src/renderer/src/review/prompt.ts`:

```ts
import type { ReviewKind } from '@shared/types'

/** POSIX single-quote escaping for embedding a prompt as one shell argument. */
export function shellSingleQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

/** `<agent> '<prompt>'` — launches the agent with the prompt as its first message. */
export function buildReviewerCommand(agentCommand: string, prompt: string): string {
  return `${agentCommand} ${shellSingleQuote(prompt)}`
}

export interface ReviewerPromptArgs {
  kind: ReviewKind
  reviewFile: string
  specPath?: string
  intent?: string
}

export function reviewerPrompt(a: ReviewerPromptArgs): string {
  const intent = a.intent?.trim()
  if (a.kind === 'spec') {
    return [
      'Ti si reviewer — drugi AI agent. NE mijenjaj spec; samo napiši kritiku u fajl.',
      `Pregledaj spec/plan u: ${a.specPath}.`,
      `Cilj autora: ${intent || '(izvedi iz samog dokumenta)'}.`,
      'Oceni kritički: ispravnost, rupe i nedorečenosti, kontradikcije, scope (YAGNI), izvodljivost.',
      'Budi konkretan; predloži tačne izmjene.',
      `Svoju kritiku UPIŠI u fajl (kreiraj ili prepiši): ${a.reviewFile}.`
    ].join('\n')
  }
  return [
    'Ti si reviewer — drugi AI agent. NE commituj; samo napiši kritiku u fajl.',
    'Pokreni `git status` i `git diff` i pregledaj necommitovane izmjene u ovom repozitorijumu.',
    `Cilj zadatka: ${intent || '(izvedi iz samih izmjena)'}.`,
    'Oceni kritički: bugove, edge-case-ove, ispravnost, jasnoću, jednostavnost.',
    `Svoju kritiku UPIŠI u fajl (kreiraj ili prepiši): ${a.reviewFile}.`
  ].join('\n')
}

export interface RelayPromptArgs {
  kind: ReviewKind
  reviewFile: string
  specPath?: string
}

export function relayToOriginPrompt(a: RelayPromptArgs): string {
  if (a.kind === 'spec') {
    return `Reviewer je ostavio kritiku u ${a.reviewFile}. Pročitaj je i ažuriraj ${a.specPath} gdje se slažeš; gdje se ne slažeš, kratko objasni zašto.`
  }
  return `Reviewer je ostavio kritiku u ${a.reviewFile}. Pročitaj je i primijeni ispravke u kodu gdje se slažeš; gdje se ne slažeš, kratko objasni. Ne commituj.`
}

export interface ReReviewPromptArgs {
  kind: ReviewKind
  reviewFile: string
  specPath?: string
}

export function reReviewPrompt(a: ReReviewPromptArgs): string {
  if (a.kind === 'spec') {
    return `Spec je ažuriran. Ponovo pregledaj ${a.specPath} i upiši novu kritiku u ${a.reviewFile}.`
  }
  return `Izmjene su ažurirane. Ponovo pokreni git diff, pregledaj i upiši novu kritiku u ${a.reviewFile}.`
}
```

- [ ] **Step 4: Pokreni testove (treba da prođu)**

Run: `npx vitest run src/renderer/src/review/prompt.test.ts`
Expected: PASS (svi testovi zeleni).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/review/prompt.ts src/renderer/src/review/prompt.test.ts
git commit -m "feat(review): pure prompt builders + shell quoting"
```

---

### Task 3: Čisto status-mapiranje

**Files:**
- Create: `src/renderer/src/review/status.ts`
- Test: `src/renderer/src/review/status.test.ts`

- [ ] **Step 1: Napiši test**

Kreiraj `src/renderer/src/review/status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { statusDot } from './status'

describe('statusDot', () => {
  it('reviewing/applying → spinner', () => {
    expect(statusDot('reviewing')).toBe('spinner')
    expect(statusDot('applying')).toBe('spinner')
  })
  it('review-ready/iteration-done → attention', () => {
    expect(statusDot('review-ready')).toBe('attention')
    expect(statusDot('iteration-done')).toBe('attention')
  })
  it('undefined → null', () => {
    expect(statusDot(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Pokreni test (treba da padne)**

Run: `npx vitest run src/renderer/src/review/status.test.ts`
Expected: FAIL — `Cannot find module './status'`.

- [ ] **Step 3: Implementiraj `status.ts`**

```ts
import type { ReviewStatus } from '@shared/types'

export type DotKind = 'spinner' | 'attention' | null

export function statusDot(status: ReviewStatus | undefined): DotKind {
  if (status === 'reviewing' || status === 'applying') return 'spinner'
  if (status === 'review-ready' || status === 'iteration-done') return 'attention'
  return null
}
```

- [ ] **Step 4: Pokreni test (treba da prođe)**

Run: `npx vitest run src/renderer/src/review/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/review/status.ts src/renderer/src/review/status.test.ts
git commit -m "feat(review): pure status→dot mapping"
```

---

## FAZA 2 — Main: fajlovi + watcher + IPC

### Task 4: `reviewFs` — putanje + suggestSpec

**Files:**
- Create: `src/main/reviewFs.ts`
- Test: `src/main/reviewFs.test.ts`

- [ ] **Step 1: Napiši testove**

Kreiraj `src/main/reviewFs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pickNewest, scanMarkdown, suggestSpec, reviewDirFor, reviewFilePath, resolveReviewPaths } from './reviewFs'

const mktmp = async () => {
  const dir = join(tmpdir(), `ttor-rev-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

describe('pickNewest', () => {
  it('returns null on empty', () => expect(pickNewest([])).toBeNull())
  it('returns the entry with greatest mtimeMs', () => {
    expect(pickNewest([{ path: 'a', mtimeMs: 1 }, { path: 'b', mtimeMs: 9 }, { path: 'c', mtimeMs: 3 }])).toBe('b')
  })
})

describe('reviewDirFor / reviewFilePath', () => {
  it('keys the dir by origin id under reviews/', () => {
    expect(reviewDirFor('/data', 'abc')).toBe(join('/data', 'reviews', 'abc'))
  })
  it('names review files review-N.md', () => {
    expect(reviewFilePath('/data/reviews/abc', 2)).toBe(join('/data/reviews/abc', 'review-2.md'))
  })
})

describe('scanMarkdown', () => {
  it('finds .md files and ignores node_modules/.git', async () => {
    const root = await mktmp()
    await fs.writeFile(join(root, 'spec.md'), '#', 'utf8')
    await fs.mkdir(join(root, 'node_modules', 'x'), { recursive: true })
    await fs.writeFile(join(root, 'node_modules', 'x', 'readme.md'), '#', 'utf8')
    const found = (await scanMarkdown(root)).map((e) => e.path)
    expect(found).toContain(join(root, 'spec.md'))
    expect(found.some((p) => p.includes('node_modules'))).toBe(false)
    await fs.rm(root, { recursive: true, force: true })
  })
})

describe('suggestSpec', () => {
  it('returns newest .md or null', async () => {
    const root = await mktmp()
    await fs.writeFile(join(root, 'old.md'), '#', 'utf8')
    await new Promise((r) => setTimeout(r, 10))
    await fs.writeFile(join(root, 'new.md'), '#', 'utf8')
    expect(await suggestSpec(root)).toBe(join(root, 'new.md'))
    await fs.rm(root, { recursive: true, force: true })
  })
  it('returns null when no markdown', async () => {
    const root = await mktmp()
    expect(await suggestSpec(root)).toBeNull()
    await fs.rm(root, { recursive: true, force: true })
  })
})

describe('resolveReviewPaths', () => {
  it('mkdir -p the review dir and returns both paths', async () => {
    const base = await mktmp()
    const { reviewDir, reviewFile } = await resolveReviewPaths(base, 'tid', 1)
    expect(reviewDir).toBe(join(base, 'reviews', 'tid'))
    expect(reviewFile).toBe(join(base, 'reviews', 'tid', 'review-1.md'))
    const stat = await fs.stat(reviewDir)
    expect(stat.isDirectory()).toBe(true)
    await fs.rm(base, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Pokreni (treba da padnu)**

Run: `npx vitest run src/main/reviewFs.test.ts`
Expected: FAIL — `Cannot find module './reviewFs'`.

- [ ] **Step 3: Implementiraj `reviewFs.ts`**

```ts
import { promises as fs } from 'fs'
import { join } from 'path'

export interface MdEntry { path: string; mtimeMs: number }

const IGNORE = new Set(['node_modules', '.git', 'release', 'out', 'dist', '.idea'])

export function pickNewest(entries: MdEntry[]): string | null {
  if (entries.length === 0) return null
  return entries.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a)).path
}

export async function scanMarkdown(root: string, maxDepth = 4): Promise<MdEntry[]> {
  const out: MdEntry[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries: import('fs').Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') { if (IGNORE.has(e.name)) continue }
      if (e.isDirectory()) {
        if (IGNORE.has(e.name)) continue
        await walk(join(dir, e.name), depth + 1)
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const full = join(dir, e.name)
        try { const st = await fs.stat(full); out.push({ path: full, mtimeMs: st.mtimeMs }) } catch { /* skip */ }
      }
    }
  }
  await walk(root, 0)
  return out
}

export async function suggestSpec(cwd: string): Promise<string | null> {
  return pickNewest(await scanMarkdown(cwd))
}

export function reviewDirFor(userDataDir: string, originTerminalId: string): string {
  return join(userDataDir, 'reviews', originTerminalId)
}

export function reviewFilePath(reviewDir: string, round: number): string {
  return join(reviewDir, `review-${round}.md`)
}

export async function resolveReviewPaths(
  userDataDir: string, originTerminalId: string, round: number
): Promise<{ reviewDir: string; reviewFile: string }> {
  const reviewDir = reviewDirFor(userDataDir, originTerminalId)
  await fs.mkdir(reviewDir, { recursive: true })
  return { reviewDir, reviewFile: reviewFilePath(reviewDir, round) }
}
```

- [ ] **Step 4: Pokreni (treba da prođu)**

Run: `npx vitest run src/main/reviewFs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/reviewFs.ts src/main/reviewFs.test.ts
git commit -m "feat(review): reviewFs — paths, suggestSpec, resolveReviewPaths"
```

---

### Task 5: `reviewWatcher` — debounced fs watch (DI)

**Files:**
- Create: `src/main/reviewWatcher.ts`
- Test: `src/main/reviewWatcher.test.ts`

- [ ] **Step 1: Napiši testove (sa fake watchImpl + fake tajmerima)**

Kreiraj `src/main/reviewWatcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dirname } from 'path'
import { createReviewWatcher, type WatchImpl } from './reviewWatcher'

// Fake watchImpl: capture listeners by directory so tests can fire events.
function makeFake() {
  const byDir = new Map<string, (filename: string | null) => void>()
  let closes = 0
  const impl: WatchImpl = (dir, listener) => {
    byDir.set(dir, listener)
    return { close: () => { closes++; byDir.delete(dir) } }
  }
  return { impl, fire: (dir: string, file: string | null) => byDir.get(dir)?.(file), closes: () => closes, dirs: () => [...byDir.keys()] }
}

describe('reviewWatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires onChanged once, debounced, when the watched file changes', () => {
    const fake = makeFake()
    const onChanged = vi.fn()
    const w = createReviewWatcher(onChanged, { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    fake.fire(dirname('/r/review-1.md'), 'review-1.md')
    fake.fire(dirname('/r/review-1.md'), 'review-1.md') // burst
    expect(onChanged).not.toHaveBeenCalled()            // still debouncing
    vi.advanceTimersByTime(400)
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('wid')
  })

  it('ignores events for other filenames in the same dir', () => {
    const fake = makeFake()
    const onChanged = vi.fn()
    const w = createReviewWatcher(onChanged, { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    fake.fire('/r', 'other.md')
    vi.advanceTimersByTime(400)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('null filename (some platforms) still triggers', () => {
    const fake = makeFake()
    const onChanged = vi.fn()
    const w = createReviewWatcher(onChanged, { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    fake.fire('/r', null)
    vi.advanceTimersByTime(400)
    expect(onChanged).toHaveBeenCalledWith('wid')
  })

  it('unwatch closes the underlying watcher and stops events', () => {
    const fake = makeFake()
    const onChanged = vi.fn()
    const w = createReviewWatcher(onChanged, { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    w.unwatch('wid')
    expect(fake.closes()).toBe(1)
    fake.fire('/r', 'review-1.md')
    vi.advanceTimersByTime(400)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('re-watching the same id replaces the previous watcher', () => {
    const fake = makeFake()
    const w = createReviewWatcher(vi.fn(), { debounceMs: 400, watchImpl: fake.impl })
    w.watch('wid', '/r/review-1.md')
    w.watch('wid', '/r/review-2.md')
    expect(fake.closes()).toBe(1)
    expect(fake.dirs()).toEqual(['/r'])
  })
})
```

- [ ] **Step 2: Pokreni (treba da padnu)**

Run: `npx vitest run src/main/reviewWatcher.test.ts`
Expected: FAIL — `Cannot find module './reviewWatcher'`.

- [ ] **Step 3: Implementiraj `reviewWatcher.ts`**

```ts
import { watch as fsWatch } from 'fs'
import { dirname, basename } from 'path'

export type WatchImpl = (
  dir: string,
  listener: (filename: string | null) => void
) => { close(): void }

const defaultWatchImpl: WatchImpl = (dir, listener) => {
  const w = fsWatch(dir, (_event, filename) => listener(filename ? filename.toString() : null))
  return { close: () => { try { w.close() } catch { /* already closed */ } } }
}

/**
 * Watches the DIRECTORY of each target file (so files that don't exist yet are
 * still caught on creation) and fires `onChanged(watchId)` — debounced — when the
 * target's basename (or a null filename) changes.
 */
export function createReviewWatcher(
  onChanged: (watchId: string) => void,
  opts: { debounceMs?: number; watchImpl?: WatchImpl } = {}
) {
  const debounceMs = opts.debounceMs ?? 400
  const watchImpl = opts.watchImpl ?? defaultWatchImpl
  const handles = new Map<string, { close(): void }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const clearTimer = (id: string) => {
    const t = timers.get(id)
    if (t) { clearTimeout(t); timers.delete(id) }
  }

  return {
    watch(watchId: string, filePath: string): void {
      this.unwatch(watchId)
      const dir = dirname(filePath)
      const base = basename(filePath)
      try {
        const handle = watchImpl(dir, (filename) => {
          if (filename !== null && filename !== base) return
          clearTimer(watchId)
          timers.set(watchId, setTimeout(() => { timers.delete(watchId); onChanged(watchId) }, debounceMs))
        })
        handles.set(watchId, handle)
      } catch { /* dir may be missing — caller created it via resolveReviewPaths */ }
    },
    unwatch(watchId: string): void {
      clearTimer(watchId)
      const h = handles.get(watchId)
      if (h) { h.close(); handles.delete(watchId) }
    },
    closeAll(): void {
      for (const id of [...handles.keys()]) this.unwatch(id)
    }
  }
}
```

- [ ] **Step 4: Pokreni (treba da prođu)**

Run: `npx vitest run src/main/reviewWatcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/reviewWatcher.ts src/main/reviewWatcher.test.ts
git commit -m "feat(review): debounced reviewWatcher with injectable watchImpl"
```

---

### Task 6: IPC kanali (shared + preload + api)

**Files:**
- Modify: `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`

- [ ] **Step 1: Dodaj kanale u `src/shared/ipc.ts`**

U objekat `IPC` dodaj (poslije `ptyProc`):

```ts
  dialogPickFile: 'dialog:pickFile',
  reviewSuggestSpec: 'review:suggestSpec',
  reviewResolveDir: 'review:resolveDir',
  fsWatch: 'fs:watch',
  fsUnwatch: 'fs:unwatch',
  fsChanged: 'fs:changed'
```

(Dodaj zarez iza `ptyProc: 'pty:proc'`.)

- [ ] **Step 2: Dodaj metode u `src/shared/api.ts`**

U `interface TerminaltorApi`, poslije `onPtyProc`:

```ts
  pickFile(opts?: { defaultPath?: string }): Promise<string | null>
  suggestSpec(cwd: string): Promise<string | null>
  resolveReviewDir(originTerminalId: string, round: number): Promise<{ reviewDir: string; reviewFile: string }>
  watchFile(watchId: string, path: string): void
  unwatchFile(watchId: string): void
  onFsChanged(cb: (watchId: string) => void): () => void
```

- [ ] **Step 3: Implementiraj u `src/preload/index.ts`**

U objekat `api`, poslije `onPtyProc`, dodaj:

```ts
  pickFile: (opts) => ipcRenderer.invoke(IPC.dialogPickFile, opts ?? {}) as Promise<string | null>,
  suggestSpec: (cwd) => ipcRenderer.invoke(IPC.reviewSuggestSpec, cwd) as Promise<string | null>,
  resolveReviewDir: (originTerminalId, round) =>
    ipcRenderer.invoke(IPC.reviewResolveDir, { originTerminalId, round }) as Promise<{ reviewDir: string; reviewFile: string }>,
  watchFile: (watchId, path) => ipcRenderer.send(IPC.fsWatch, { watchId, path }),
  unwatchFile: (watchId) => ipcRenderer.send(IPC.fsUnwatch, { watchId }),
  onFsChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { watchId: string }) => cb(p.watchId)
    ipcRenderer.on(IPC.fsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.fsChanged, listener)
  },
```

(Dodaj zarez iza prethodnog `onPtyProc` bloka.)

- [ ] **Step 4: Verifikuj typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc.ts src/shared/api.ts src/preload/index.ts
git commit -m "feat(review): IPC surface — pickFile/suggestSpec/resolveReviewDir/fs watch"
```

---

### Task 7: Registruj IPC handlere u main

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/index.ts`

- [ ] **Step 1: Proslijedi `userDataDir` u `registerIpc`**

U `src/main/index.ts`, u pozivu `registerIpc({...})` dodaj polje:

```ts
    workspacePath: join(app.getPath('userData'), 'workspace.json'),
    userDataDir: app.getPath('userData')
```

- [ ] **Step 2: Proširi `registerIpc` u `src/main/ipc.ts`**

Dodaj importe na vrh:

```ts
import { suggestSpec, resolveReviewPaths } from './reviewFs'
import { createReviewWatcher } from './reviewWatcher'
```

Proširi `opts` tip funkcije `registerIpc` poljem:

```ts
  userDataDir: string
```

i u destrukturiranju: `const { getWin, ptyManager, workspacePath, userDataDir } = opts`.

Pred `return saver`, dodaj registracije:

```ts
  ipcMain.handle(IPC.dialogPickFile, async (_e, o: { defaultPath?: string }) => {
    const win = getWin()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }, { name: 'Sve', extensions: ['*'] }],
      ...(o?.defaultPath ? { defaultPath: o.defaultPath } : {})
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.reviewSuggestSpec, (_e, cwd: string) => suggestSpec(cwd || os.homedir()))

  ipcMain.handle(IPC.reviewResolveDir, (_e, p: { originTerminalId: string; round: number }) =>
    resolveReviewPaths(userDataDir, p.originTerminalId, p.round))

  const reviewWatcher = createReviewWatcher((watchId) => send(IPC.fsChanged, { watchId }))
  ipcMain.on(IPC.fsWatch, (_e, p: { watchId: string; path: string }) => reviewWatcher.watch(p.watchId, p.path))
  ipcMain.on(IPC.fsUnwatch, (_e, p: { watchId: string }) => reviewWatcher.unwatch(p.watchId))
```

- [ ] **Step 3: Verifikuj typecheck + cijeli test-suite**

Run: `npm run typecheck && npm test`
Expected: PASS (postojeći + novi testovi zeleni).

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts
git commit -m "feat(review): wire reviewFs + reviewWatcher into main IPC"
```

---

## FAZA 3 — Store glue + orkestracija

### Task 8: Store — review na terminalu + selektori

**Files:**
- Modify: `src/renderer/src/store.ts`
- Test: `src/renderer/src/store.test.ts`

- [ ] **Step 1: Napiši testove**

Dodaj u `src/renderer/src/store.test.ts` (importe proširi sa `setReviewRound, findReviewerFor, featureIdOfTerminal, getTerminalById`):

```ts
describe('review store', () => {
  const link = (originId: string, round = 1) => ({
    originTerminalId: originId, reviewKind: 'spec' as const,
    specPath: '/a/spec.md', reviewDir: '/r', round
  })

  it('addTerminal can attach a review link', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'review: codex', kind: 'codex', review: link('origin-1') })
    const t = getActiveTerminal(s)!
    expect(t.review?.originTerminalId).toBe('origin-1')
    expect(t.review?.round).toBe(1)
  })

  it('findReviewerFor locates the reviewer of an origin', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'A', kind: 'claude' })
    const aId = getActiveTerminal(s)!.id
    s = addTerminal(s, fid, { name: 'review: codex', kind: 'codex', review: link(aId) })
    const reviewer = findReviewerFor(s, aId)
    expect(reviewer?.name).toBe('review: codex')
    expect(findReviewerFor(s, 'nope')).toBeNull()
  })

  it('setReviewRound bumps the round on a reviewer terminal', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'review: codex', kind: 'codex', review: link('o', 1) })
    const bId = getActiveTerminal(s)!.id
    s = setReviewRound(s, bId, 2)
    expect(findReviewerFor(s, 'o')?.review?.round).toBe(2)
  })

  it('featureIdOfTerminal / getTerminalById resolve a terminal', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'A', kind: 'claude' })
    const aId = getActiveTerminal(s)!.id
    expect(featureIdOfTerminal(s, aId)).toBe(fid)
    expect(getTerminalById(s, aId)?.name).toBe('A')
    expect(featureIdOfTerminal(s, 'x')).toBeNull()
  })
})
```

- [ ] **Step 2: Pokreni (treba da padnu)**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: FAIL — `findReviewerFor` itd. nisu eksportovani.

- [ ] **Step 3: Implementiraj izmjene u `store.ts`**

a) Import `ReviewLink` iz tipova (proširi postojeći import):

```ts
import { Workspace, Group, Feature, Terminal, TerminalKind, ReviewLink, createWorkspace } from '@shared/types'
```

b) Proširi `addTerminal` input i kreiranje terminala. Zamijeni potpis i tijelo:

```ts
export function addTerminal(
  state: AppState,
  featureId: string,
  input: { name: string; startupCommand?: string; kind?: TerminalKind; review?: ReviewLink }
): AppState {
  const group = groupOfFeature(state.workspace, featureId)
  const startupCommand = input.startupCommand?.trim()
  const term: Terminal = {
    id: createId(),
    name: input.name,
    cwd: group?.cwd ?? '',
    startupCommand: startupCommand || undefined,
    kind: input.kind && input.kind !== 'shell' ? input.kind : undefined,
    ...(input.review ? { review: input.review } : {})
  }
  return {
    ...state,
    workspace: mapFeature(state.workspace, featureId, (f) => ({ ...f, collapsed: false, terminals: [...f.terminals, term] })),
    activeGroupId: group?.id ?? state.activeGroupId,
    activeFeatureId: featureId,
    activeTerminalId: term.id
  }
}
```

c) Dodaj (ispod `renameTerminal`) novu funkciju `setReviewRound`:

```ts
export function setReviewRound(state: AppState, terminalId: string, round: number): AppState {
  return {
    ...state,
    workspace: mapGroups(state.workspace, (g) => ({
      ...g,
      features: g.features.map((f) => ({
        ...f,
        terminals: f.terminals.map((t) =>
          t.id === terminalId && t.review ? { ...t, review: { ...t.review, round } } : t)
      }))
    }))
  }
}
```

d) Dodaj selektore (na kraj fajla, uz ostale selektore):

```ts
export const getTerminalById = (s: AppState, id: string): Terminal | null =>
  allTerminals(s).find((t) => t.id === id) ?? null

export const findReviewerFor = (s: AppState, originId: string): Terminal | null =>
  allTerminals(s).find((t) => t.review?.originTerminalId === originId) ?? null

export const featureIdOfTerminal = (s: AppState, terminalId: string): string | null => {
  for (const g of s.workspace.groups) for (const f of g.features) if (f.terminals.some((t) => t.id === terminalId)) return f.id
  return null
}
```

- [ ] **Step 4: Pokreni (treba da prođu)**

Run: `npx vitest run src/renderer/src/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store.ts src/renderer/src/store.test.ts
git commit -m "feat(review): store — review link on terminal + selectors"
```

---

### Task 9: `useReview` hook — orkestracija

**Files:**
- Create: `src/renderer/src/review/useReview.ts`

> Glue oko store + IPC + watch-eva. Logika je već pokrivena čistim testovima (prompt/status/store); ovaj hook se verifikuje typecheck-om i manual E2E (Task 14).

- [ ] **Step 1: Implementiraj hook**

Kreiraj `src/renderer/src/review/useReview.ts`:

```ts
import { useRef, useCallback } from 'react'
import type { AppState } from '../store'
import { addTerminal, setReviewRound, findReviewerFor, featureIdOfTerminal, getTerminalById } from '../store'
import type { ReviewKind, ReviewStatus } from '@shared/types'
import { AGENTS, type AgentKind } from '../agents'
import { buildReviewerCommand, reviewerPrompt, relayToOriginPrompt, reReviewPrompt } from './prompt'

export interface StartReviewArgs {
  originTerminalId: string
  reviewer: AgentKind
  kind: ReviewKind
  specPath?: string
  intent?: string
}

// watchId → which terminal becomes which status when its file changes.
interface WatchTarget { terminalId: string; status: ReviewStatus }

export function useReview(
  state: AppState,
  apply: (fn: (s: AppState) => AppState) => void,
  setStatus: (id: string, status: ReviewStatus | undefined) => void
) {
  const targets = useRef(new Map<string, WatchTarget>())

  const armWatch = useCallback((watchId: string, path: string, target: WatchTarget) => {
    targets.current.set(watchId, target)
    window.terminaltor.watchFile(watchId, path)
  }, [])

  // Called by App on every fs:changed event.
  const handleFsChanged = useCallback((watchId: string) => {
    const t = targets.current.get(watchId)
    if (!t) return
    targets.current.delete(watchId)
    window.terminaltor.unwatchFile(watchId)
    setStatus(t.terminalId, t.status)
  }, [setStatus])

  const startReview = useCallback(async (a: StartReviewArgs) => {
    const featureId = featureIdOfTerminal(state, a.originTerminalId)
    if (!featureId) return
    const round = 1
    const { reviewDir, reviewFile } = await window.terminaltor.resolveReviewDir(a.originTerminalId, round)
    const prompt = reviewerPrompt({ kind: a.kind, specPath: a.specPath, reviewFile, intent: a.intent })
    const startupCommand = buildReviewerCommand(AGENTS[a.reviewer].command, prompt)

    // Reviewer terminal id isn't known until addTerminal runs; capture it from the
    // resulting state (addTerminal sets activeTerminalId to the new terminal).
    apply((s) => {
      const next = addTerminal(s, featureId, {
        name: `review: ${a.reviewer}`,
        kind: a.reviewer,
        startupCommand,
        review: { originTerminalId: a.originTerminalId, reviewKind: a.kind, specPath: a.specPath, reviewDir, round }
      })
      const reviewerId = next.activeTerminalId!
      setStatus(reviewerId, 'reviewing')
      armWatch(`review:${reviewerId}:${round}`, reviewFile, { terminalId: reviewerId, status: 'review-ready' })
      return next
    })
  }, [state, apply, setStatus, armWatch])

  const relayToOrigin = useCallback((reviewerId: string) => {
    const reviewer = getTerminalById(state, reviewerId)
    const link = reviewer?.review
    if (!link) return
    const reviewFile = `${link.reviewDir}/review-${link.round}.md`
    const text = relayToOriginPrompt({ kind: link.reviewKind, reviewFile, specPath: link.specPath })
    window.terminaltor.writePty(link.originTerminalId, text + '\r')
    setStatus(reviewerId, undefined)
    setStatus(link.originTerminalId, 'applying')
    // Auto status for 'spec' only (single file to watch). 'impl' → manual (Task 13).
    if (link.reviewKind === 'spec' && link.specPath) {
      armWatch(`spec:${link.originTerminalId}:${link.round}`, link.specPath,
        { terminalId: link.originTerminalId, status: 'iteration-done' })
    }
  }, [state, setStatus, armWatch])

  const reReview = useCallback(async (originId: string) => {
    const reviewer = findReviewerFor(state, originId)
    const link = reviewer?.review
    if (!reviewer || !link) return
    const round = link.round + 1
    const { reviewFile } = await window.terminaltor.resolveReviewDir(originId, round)
    const text = reReviewPrompt({ kind: link.reviewKind, specPath: link.specPath, reviewFile })
    window.terminaltor.writePty(reviewer.id, text + '\r')
    apply((s) => setReviewRound(s, reviewer.id, round))
    setStatus(originId, undefined)
    setStatus(reviewer.id, 'reviewing')
    armWatch(`review:${reviewer.id}:${round}`, reviewFile, { terminalId: reviewer.id, status: 'review-ready' })
  }, [state, apply, setStatus, armWatch])

  const markApplied = useCallback((originId: string) => setStatus(originId, 'iteration-done'), [setStatus])

  return { startReview, relayToOrigin, reReview, markApplied, handleFsChanged }
}
```

- [ ] **Step 2: Verifikuj typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/review/useReview.ts
git commit -m "feat(review): useReview orchestration hook"
```

---

## FAZA 4 — ReviewDialog + ulazna tačka

### Task 10: `ReviewDialog` komponenta

**Files:**
- Create: `src/renderer/src/components/ReviewDialog.tsx`
- Test: `src/renderer/src/components/ReviewDialog.test.tsx`

- [ ] **Step 1: Napiši test**

Kreiraj `src/renderer/src/components/ReviewDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewDialog } from './ReviewDialog'

beforeEach(() => {
  // @ts-expect-error test stub
  window.terminaltor = {
    suggestSpec: vi.fn().mockResolvedValue('/p/docs/spec.md'),
    pickFile: vi.fn().mockResolvedValue('/p/other.md')
  }
})

const baseProps = { originName: 'claude', defaultReviewer: 'codex' as const, cwd: '/p' }

describe('ReviewDialog', () => {
  it('prefills the suggested spec path on mount', async () => {
    render(<ReviewDialog {...baseProps} onStart={vi.fn()} onCancel={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Spec fajl')).toHaveValue('/p/docs/spec.md'))
  })

  it('starts a spec review with chosen reviewer + intent', async () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Spec fajl')).toHaveValue('/p/docs/spec.md'))
    fireEvent.change(screen.getByLabelText('Namjera (opciono)'), { target: { value: 'auth' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pokreni review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', kind: 'spec', specPath: '/p/docs/spec.md', intent: 'auth' })
  })

  it('implementation review needs no spec path', async () => {
    const onStart = vi.fn()
    render(<ReviewDialog {...baseProps} onStart={onStart} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Implementacija'))
    fireEvent.click(screen.getByRole('button', { name: 'Pokreni review' }))
    expect(onStart).toHaveBeenCalledWith({ reviewer: 'codex', kind: 'impl', specPath: undefined, intent: '' })
  })
})
```

- [ ] **Step 2: Pokreni (treba da padne)**

Run: `npx vitest run src/renderer/src/components/ReviewDialog.test.tsx`
Expected: FAIL — `Cannot find module './ReviewDialog'`.

- [ ] **Step 3: Implementiraj `ReviewDialog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { ReviewKind } from '@shared/types'
import type { AgentKind } from '../agents'

export interface ReviewStartArgs {
  reviewer: AgentKind
  kind: ReviewKind
  specPath?: string
  intent: string
}

export function ReviewDialog({
  originName, defaultReviewer, cwd, onStart, onCancel
}: {
  originName: string
  defaultReviewer: AgentKind
  cwd: string
  onStart: (args: ReviewStartArgs) => void
  onCancel: () => void
}) {
  const [reviewer, setReviewer] = useState<AgentKind>(defaultReviewer)
  const [kind, setKind] = useState<ReviewKind>('spec')
  const [specPath, setSpecPath] = useState('')
  const [intent, setIntent] = useState('')

  useEffect(() => {
    let cancelled = false
    window.terminaltor.suggestSpec(cwd).then((p) => { if (!cancelled && p) setSpecPath(p) })
    return () => { cancelled = true }
  }, [cwd])

  const browse = async () => {
    const p = await window.terminaltor.pickFile({ defaultPath: specPath || cwd })
    if (p) setSpecPath(p)
  }

  const submit = () => {
    if (kind === 'spec' && !specPath.trim()) return
    onStart({ reviewer, kind, specPath: kind === 'spec' ? specPath.trim() : undefined, intent: intent.trim() })
  }

  const field = 'mt-1 w-full rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition'
  const seg = (active: boolean) =>
    `px-3 py-1 text-sm rounded-md transition ${active ? 'bg-accent text-surface' : 'bg-field text-fg-muted hover:text-fg'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[30rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold tracking-tight text-fg-bright">Review</h2>
        <p className="mb-4 text-xs text-fg-muted">Recenzira se terminal „{originName}".</p>

        <div className="mb-3">
          <span className="text-sm text-fg">Reviewer</span>
          <div className="mt-1 flex gap-2">
            <button type="button" className={seg(reviewer === 'claude')} onClick={() => setReviewer('claude')}>Claude</button>
            <button type="button" className={seg(reviewer === 'codex')} onClick={() => setReviewer('codex')}>Codex</button>
          </div>
        </div>

        <div className="mb-3">
          <span className="text-sm text-fg">Tip</span>
          <div className="mt-1 flex gap-2">
            <button type="button" aria-label="Spec/plan" aria-pressed={kind === 'spec'} className={seg(kind === 'spec')} onClick={() => setKind('spec')}>Spec/plan</button>
            <button type="button" aria-label="Implementacija" aria-pressed={kind === 'impl'} className={seg(kind === 'impl')} onClick={() => setKind('impl')}>Implementacija</button>
          </div>
        </div>

        {kind === 'spec' ? (
          <label className="block mb-3 text-sm text-fg">
            Spec fajl
            <div className="mt-1 flex gap-2">
              <input aria-label="Spec fajl" value={specPath} onChange={(e) => setSpecPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field.replace('mt-1 ', '')} />
              <button type="button" onClick={browse} className="shrink-0 rounded-md bg-field px-3 text-sm text-fg-muted hover:text-fg transition">Browse…</button>
            </div>
          </label>
        ) : (
          <p className="mb-3 text-sm text-fg-muted">Artefakt: <code className="text-fg">git diff</code> u <code className="text-fg">{cwd || '~'}</code>.</p>
        )}

        <label className="block mb-4 text-sm text-fg">
          Namjera (opciono)
          <input aria-label="Namjera (opciono)" value={intent} placeholder="koji je cilj…"
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field} />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors">Otkaži</button>
          <button onClick={submit} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:bg-accent-strong transition-colors">Pokreni review</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Pokreni (treba da prođe)**

Run: `npx vitest run src/renderer/src/components/ReviewDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ReviewDialog.tsx src/renderer/src/components/ReviewDialog.test.tsx
git commit -m "feat(review): ReviewDialog (reviewer/type/spec/intent)"
```

---

### Task 11: Ikone — Spinner + Review

**Files:**
- Modify: `src/renderer/src/components/icons.tsx`

- [ ] **Step 1: Dodaj `SpinnerIcon` i `ReviewIcon`**

Na kraj `src/renderer/src/components/icons.tsx` (prije eventualnog default-a; fajl koristi imenovane eksporte) dodaj:

```tsx
export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={`animate-spin ${className ?? ''}`}
      data-testid="icon-spinner" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 3 a9 9 0 0 1 9 9" />
    </svg>
  )
}

export function ReviewIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={className}
      data-testid="icon-review" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16 L21 21" />
    </svg>
  )
}
```

- [ ] **Step 2: Verifikuj typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/icons.tsx
git commit -m "feat(icons): SpinnerIcon + ReviewIcon"
```

---

### Task 12: `ReviewStatusDot` + Sidebar/TabBar ulazna tačka i dot

**Files:**
- Create: `src/renderer/src/components/ReviewStatusDot.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/TabBar.tsx`

> **Preporučena ulazna tačka:** iskoristi postojeći `ContextMenu`. U `Sidebar` redu terminala dodaj `onContextMenu` koji otvara meni sa dvije stavke — „Review ▸ Claude" (`onReviewTerminal(t.id, 'claude')`) i „Review ▸ Codex" (`onReviewTerminal(t.id, 'codex')`) — po uzoru na postojeći grupni `setMenu({ x, y, ... })` obrazac. Time se proslijeđuje i predizabran reviewer u `ReviewDialog`. Donji koraci pokazuju hover-dugme varijantu (`onReviewTerminal(t.id)` bez reviewer-a); ako koristiš context-meni, proširi `onReviewTerminal` potpis sa opcionim `reviewer?: AgentKind` i u App-u ga proslijedi `ReviewDialog`-u kao `defaultReviewer`.

- [ ] **Step 1: Kreiraj `ReviewStatusDot.tsx`**

```tsx
import type { ReviewStatus } from '@shared/types'
import { statusDot } from '../review/status'
import { SpinnerIcon } from './icons'

export function ReviewStatusDot({ status }: { status: ReviewStatus | undefined }) {
  const dot = statusDot(status)
  if (dot === null) return null
  if (dot === 'spinner') return <SpinnerIcon className="shrink-0 text-accent" />
  return <span data-testid="review-attention" title="Pogledaj rezultat" className="shrink-0 h-2 w-2 rounded-full bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.7)]" />
}
```

- [ ] **Step 2: Proširi `Sidebar` props i red terminala**

U `Sidebar.tsx`:

a) Importi (dodaj uz postojeće):

```tsx
import type { ReviewStatus } from '@shared/types'
import { TerminalKindIcon, ClaudeIcon, CodexIcon, GridIcon, ReviewIcon } from './icons'
import { ReviewStatusDot } from './ReviewStatusDot'
```

b) U props tip dodaj:

```tsx
  reviewStatus: Record<string, ReviewStatus | undefined>
  onReviewTerminal: (terminalId: string) => void
```

i u destrukturiranju props-a dodaj `reviewStatus, onReviewTerminal`.

c) U redu terminala — zamijeni postojeći `<div ... data-term-id ...>` blok tako da doda dot i Review hover-dugme. Konkretno, unutar tog reda, poslije `<TerminalKindIcon ... />` dodaj:

```tsx
                              <ReviewStatusDot status={reviewStatus[t.id]} />
```

a poslije imena terminala (poslije `<span ...>{t.name}</span>` / rename-input ternarnog izraza), dodaj hover-dugme (unutar istog `<div>` reda, kao zadnje dijete):

```tsx
                              <button aria-label={`Review ${t.name}`} title="Review (drugi agent)"
                                onClick={(e) => { e.stopPropagation(); onReviewTerminal(t.id) }}
                                className="opacity-0 group-hover:opacity-100 ml-auto px-1 text-fg-muted hover:text-accent transition">
                                <ReviewIcon />
                              </button>
```

- [ ] **Step 3: Proširi `TabBar` props i tab**

U `TabBar.tsx`:

a) Importi:

```tsx
import type { ReviewStatus } from '@shared/types'
import { TerminalKindIcon, ClaudeIcon, CodexIcon, GridIcon, ReviewIcon } from './icons'
import { ReviewStatusDot } from './ReviewStatusDot'
```

b) U props tip dodaj:

```tsx
  reviewStatus: Record<string, ReviewStatus | undefined>
  onReviewTerminal: (id: string) => void
```

i u destrukturiranju funkcije dodaj `reviewStatus, onReviewTerminal`.

c) U svakom tabu, poslije `<TerminalKindIcon ... />` dodaj dot:

```tsx
            <ReviewStatusDot status={reviewStatus[t.id]} />
```

d) Poslije close (×) dugmeta u tabu dodaj Review dugme:

```tsx
            <button aria-label={`Review ${t.name}`} title="Review (drugi agent)"
              onClick={(e) => { e.stopPropagation(); onReviewTerminal(t.id) }}
              className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-accent transition-colors">
              <ReviewIcon />
            </button>
```

- [ ] **Step 4: Verifikuj postojeće komponentne testove + typecheck**

Run: `npm run typecheck && npx vitest run src/renderer/src/components/TabBar.test.tsx src/renderer/src/components/Sidebar.test.tsx`
Expected: Testovi koji renderuju `Sidebar`/`TabBar` mogu pasti zbog novih **obaveznih** props-a. Ako padnu, u tim test fajlovima dodaj `reviewStatus={{}}` i `onReviewTerminal={() => {}}` (i `onReviewTerminal`/`reviewStatus` u helper-render funkcije). Ponovi dok ne budu zeleni.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ReviewStatusDot.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/TabBar.tsx src/renderer/src/components/TabBar.test.tsx src/renderer/src/components/Sidebar.test.tsx
git commit -m "feat(review): status dot + Review entry button in Sidebar/TabBar"
```

---

## FAZA 5 — App glue + relay dugmad

### Task 13: Relay dugmad u TabBar (za aktivni terminal)

**Files:**
- Modify: `src/renderer/src/components/TabBar.tsx`

> Dugmad zavise od uloge aktivnog terminala. Da TabBar ostane „glup", App mu prosljeđuje gotove flag-ove i callback-e.

- [ ] **Step 1: Proširi `TabBar` props**

Dodaj u props tip:

```tsx
  relay: { canReturn: boolean; canReReview: boolean; canMarkApplied: boolean }
  onReturnToOrigin: () => void
  onReReview: () => void
  onMarkApplied: () => void
```

i destrukturiraj `relay, onReturnToOrigin, onReReview, onMarkApplied`.

- [ ] **Step 2: Renderuj dugmad u desnom bloku TabBar-a**

Unutar `<div className="ml-1 self-center flex items-center gap-0.5 ...">`, na početak (prije Grid dugmeta) dodaj:

```tsx
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
```

- [ ] **Step 3: Verifikuj typecheck**

Run: `npm run typecheck`
Expected: FAIL u `App.tsx` / `TabBar.test.tsx` (nedostaju novi props). To se rješava u Task 14; za sada provjeri samo da `TabBar.tsx` sam nema sintaksnih grešaka pokretanjem testa komponente — može i ostati crveno do Task 14.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/TabBar.tsx
git commit -m "feat(review): relay buttons in TabBar (return/re-review/mark-applied)"
```

---

### Task 14: App glue — sve spojiti

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify (ako treba): `src/renderer/src/components/TabBar.test.tsx`

- [ ] **Step 1: Dodaj review state + hook u `App.tsx`**

a) Importi (proširi postojeće):

```tsx
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode,
  addTerminal, renameTerminal, removeTerminal,
  setActiveTerminal,
  getActiveGroup, getActiveFeature, getActiveTerminal, getTerminalById, findReviewerFor, allTerminals
} from './store'
import type { ReviewStatus } from '@shared/types'
import { useReview } from './review/useReview'
import { ReviewDialog, type ReviewStartArgs } from './components/ReviewDialog'
```

b) Unutar `App()`, uz ostale `useState`, dodaj:

```tsx
  const [reviewStatus, setReviewStatus] = useState<Record<string, ReviewStatus | undefined>>({})
  const [reviewFor, setReviewFor] = useState<string | null>(null)   // origin terminal id za ReviewDialog
  const setStatus = (id: string, status: ReviewStatus | undefined) =>
    setReviewStatus((m) => ({ ...m, [id]: status }))
  const review = useReview(state, apply, setStatus)
```

c) Pretplati se na `fs:changed` (uz postojeći `onPtyProc` useEffect, novi effect):

```tsx
  useEffect(() => window.terminaltor.onFsChanged(review.handleFsChanged), [review.handleFsChanged])
```

- [ ] **Step 2: Izvedi relay-flagove za aktivni terminal**

Ispod `const activeFeature = getActiveFeature(state)` dodaj:

```tsx
  const activeTerminal = getActiveTerminal(state)
  const activeReviewerLink = activeTerminal?.review ?? null
  const activeIsOrigin = activeTerminal ? findReviewerFor(state, activeTerminal.id) !== null : false
  const activeStatus = activeTerminal ? reviewStatus[activeTerminal.id] : undefined
  const relayFlags = {
    canReturn: !!activeReviewerLink && activeStatus === 'review-ready',
    canReReview: activeIsOrigin && activeStatus === 'iteration-done',
    canMarkApplied: activeIsOrigin && activeStatus === 'applying'
  }
  const startReview = (args: ReviewStartArgs) => {
    if (!reviewFor) return
    void review.startReview({ originTerminalId: reviewFor, ...args })
    setReviewFor(null)
  }
```

- [ ] **Step 3: Proslijedi nove props Sidebar-u i TabBar-u**

U `<Sidebar ... />` dodaj:

```tsx
        reviewStatus={reviewStatus}
        onReviewTerminal={(id) => setReviewFor(id)}
```

U `<TabBar ... />` dodaj:

```tsx
          reviewStatus={reviewStatus}
          onReviewTerminal={(id) => setReviewFor(id)}
          relay={relayFlags}
          onReturnToOrigin={() => { if (activeTerminal) review.relayToOrigin(activeTerminal.id) }}
          onReReview={() => { if (activeTerminal) void review.reReview(activeTerminal.id) }}
          onMarkApplied={() => { if (activeTerminal) review.markApplied(activeTerminal.id) }}
```

- [ ] **Step 4: Renderuj `ReviewDialog`**

Pred zatvaranje glavnog `</div>` (uz `{groupDialogOpen && ...}`), dodaj:

```tsx
      {reviewFor && (() => {
        const origin = getTerminalById(state, reviewFor)
        if (!origin) return null
        const currentKind = liveAgents[origin.id] ?? origin.kind
        const defaultReviewer = currentKind === 'claude' ? 'codex' : 'claude'
        const group = state.workspace.groups.find((g) => g.features.some((f) => f.terminals.some((t) => t.id === origin.id)))
        return (
          <ReviewDialog
            originName={origin.name}
            defaultReviewer={defaultReviewer}
            cwd={group?.cwd ?? ''}
            onStart={startReview}
            onCancel={() => setReviewFor(null)}
          />
        )
      })()}
```

- [ ] **Step 5: Popravi `TabBar.test.tsx` ako padne**

`TabBar` sad ima obavezne props `relay`, `onReturnToOrigin`, `onReReview`, `onMarkApplied`, `reviewStatus`, `onReviewTerminal`. U `TabBar.test.tsx` dodaj podrazumijevane vrijednosti u render helper:

```tsx
  relay={{ canReturn: false, canReReview: false, canMarkApplied: false }}
  onReturnToOrigin={() => {}}
  onReReview={() => {}}
  onMarkApplied={() => {}}
  reviewStatus={{}}
  onReviewTerminal={() => {}}
```

- [ ] **Step 6: Verifikuj cijeli suite + typecheck + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS (typecheck čist, svi testovi zeleni, build prolazi).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/TabBar.test.tsx
git commit -m "feat(review): wire ReviewDialog, status + relay into App"
```

---

### Task 15: Manual E2E (dev sesija)

**Files:** nema (ručna verifikacija).

- [ ] **Step 1: Pokreni app**

Run: `npm run dev`

- [ ] **Step 2: Spec review tok**

1. Napravi grupu sa stvarnim repo cwd-om; u feature pokreni **Claude** (quick-launch). Neka napiše/ima neki `*.md` spec u repou.
2. Hover na taj terminal → klikni **Review** ikonu. Dijalog: reviewer=Codex (predizabran), tip=Spec/plan, spec polje predloženo (`suggestSpec`). Unesi namjeru. **Pokreni review**.
3. Provjeri: novi terminal „review: codex" se otvorio u istom feature-u; na njemu **spinner** (🔄). Codex je startovan sa promptom kao CLI argumentom.
4. Kad Codex upiše `review-1.md` (`<userData>/reviews/<originId>/`): dot pređe u **žuto** (🟡). (Provjeri da fajl postoji van projekta i da `git status` u repou NE pokazuje nove fajlove.)
5. Selektuj review terminal → **→ Vrati u A**: u Claude terminal je ubrizgan prompt; Claude dot → **spinner** (applying).
6. Kad Claude izmijeni spec fajl: Claude dot → **žuto** (iteration-done).
7. Selektuj Claude terminal → **↻ Ponovi review**: Codex dobije re-review, piše `review-2.md`; spinner→žuto ponovo.

- [ ] **Step 3: Implementation review tok**

Napravi izmjene u kodu sa agentom, pokreni Review tip=**Implementacija**. Provjeri da reviewer pokrene `git diff`, upiše `review-1.md`, dot→žuto, **→ Vrati u A** ubrizga relay; pošto je `impl` (nema spec-watch), za „A gotovo" koristi **✓ Gotovo** dugme (ručni fallback).

- [ ] **Step 4: Dozvole + restart**

- Potvrdi eventualne dozvole agenta za čitanje/pisanje van cwd-a (jednom po terminalu).
- Ugasi i upali app: review terminali se vraćaju (perzistiran `review` link); status (dot) je prazan dok se ne pokrene nova akcija — očekivano.

- [ ] **Step 5: Commit (ako je bilo sitnih ispravki)**

```bash
git add -A && git commit -m "fix(review): manual E2E adjustments"
```

---

## Self-Review (popunjeno tokom pisanja plana)

**Spec coverage:**
- §1 pojmovi → Task 1 (tipovi). ✓
- §3 model (`ReviewLink`/`ReviewStatus`/`Terminal.review`) → Task 1, Task 8 (store). ✓
- §4 putanje van projekta → Task 4 (`reviewFs`), Task 7 (`resolveReviewDir` koristi `userDataDir`). ✓
- §5 prompt-ovi → Task 2. ✓
- §6 relay injekcija (`+ '\r'`) → Task 9 (`relayToOrigin`/`reReview`). ✓
- §7 IPC kanali → Task 6, Task 7. ✓
- §8 status detekcija (fs-vođeno) + §8.1 impl fallback → Task 5 (watcher), Task 9 (`armWatch`, impl→manual), Task 13 (`✓ Gotovo`). ✓
- §9 UI (ulazna tačka, dot, relay dugmad) → Task 10, 11, 12, 13, 14. ✓
- §10 orkestracija → Task 9. ✓
- §11 testiranje → Task 2/3/4/5/8/10 testovi + Task 15 E2E. ✓
- §13 caveati (dozvole/timing/impl/restart) → Task 15 koraci 3–4. ✓

**Placeholder scan:** Nema TBD/„handle edge cases"/praznih koraka; svaki kod-korak ima pun kod. ✓

**Type consistency:** `ReviewLink`/`ReviewStatus`/`ReviewKind` konzistentni kroz types→store→useReview→komponente. `resolveReviewDir(originTerminalId, round)` isti potpis u api/preload/main/useReview. `statusDot` → `'spinner'|'attention'|null` isto u status.ts i ReviewStatusDot. watchId format `review:<id>:<round>` / `spec:<id>:<round>` konzistentan u useReview. ✓

**Napomena o startup invokaciji:** Plan pretpostavlja da `claude '<prompt>'` i `codex '<prompt>'` pokreću agent interaktivno sa promptom kao prvom porukom. Ako konkretna verzija CLI-ja zahtijeva drugačiji oblik, mijenja se **samo** `buildReviewerCommand` (Task 2) — jedna tačka.

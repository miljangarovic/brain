# Claude Resume Fallback: Fresh Session When the Pinned One Is Gone — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

A restored claude terminal whose pinned session no longer exists currently
spawns `claude --resume <id>`, which prints
`No conversation found with session ID: <id>` and exits — the terminal is
dead on arrival. Instead, detect the missing session BEFORE spawning and
launch a fresh conversation with a NEW pinned id, persisting that id so the
next restart resumes the new session.

## Scope

- **Claude only.** `codex resume <id>` can fail the same way, but locating a
  rollout by id means scanning every day directory, and codex can't pin an
  id at launch — explicitly out of scope (revisit if it bites).
- **Pre-flight check, not output sniffing.** The transcript path is fully
  known (`~/.claude/projects/<cwd-dashes>/<sessionId>.jsonl`), so existence
  is checked before the PTY spawns. No matching on CLI error strings, no
  kill-and-respawn.
- **Legacy `--continue` covered too:** a terminal persisted before id
  pinning resumes via `claude --continue`, which dies the same way when the
  cwd has no sessions at all. The same channel answers "any session in this
  cwd?" when no id is given; the fallback is then a plain `claude`.
- Codex terminals, plain shells, and fresh (non-restored) launches are
  untouched.

## Decisions

- **Check in main, decide in the renderer:** the renderer can't build the
  transcript path (homedir + dash encoding live in main's
  `claudeProjectDir`). New invoke channel `claudeSessionExists({ cwd,
  sessionId? })` → boolean: with an id, an exact-file check; without one,
  "does the project dir hold any `.jsonl`" (reuses `newestJsonl`).
- **Fallback generates and persists a new id:** the spawn command becomes
  `claude --session-id <createId()>` and the new id is reported up via a
  `onSessionFallback(terminalId, sessionId)` callback prop
  (App → TerminalPane → TerminalView, same threading as `onOpenFile`); App
  applies the existing `setTerminalSessionId`. Without persisting, every
  restart would retry the dead id.
- **Stale `startupCommand` stays:** it embeds the ORIGINAL `--session-id`
  pin, but restored agent terminals always spawn through the resume path
  (spawnGate), which reads the `sessionId` field — the persisted command is
  only ever used for a terminal's very first mount.
- **Spawn turns async only on the affected path:** resume + claude awaits
  the check, every other case spawns synchronously exactly as today. A
  `cancelled` guard in the effect cleanup prevents a late check from
  spawning a PTY after the view unmounted.
- **Fail-safe direction:** if the existence check itself errors, treat the
  session as missing — a fresh conversation beats a dead terminal.
- **The user sees why history is gone:** before the fallback spawn the view
  writes a yellow xterm line:
  `[previous session not found — starting fresh]` (same styling as the
  existing `[process exited]` notice).

## Changes by module

| Module | Change |
|---|---|
| `src/main/transcript.ts` | `claudeSessionExists(opts: { home?; cwd; sessionId? }): Promise<boolean>` — exact `<sessionId>.jsonl` check, or any-session check via `newestJsonl` when no id |
| `src/shared/ipc.ts` | `claudeSessionExists: 'agent:claudeSessionExists'` |
| `src/main/ipc.ts` | `ipcMain.handle(IPC.claudeSessionExists, …)` → `claudeSessionExists({ cwd, sessionId })` |
| `src/preload/index.ts` + `index.d.ts` | `claudeSessionExists(cwd: string, sessionId?: string): Promise<boolean>` |
| `src/renderer/src/components/TerminalView.tsx` | resume + claude: await `window.brain.claudeSessionExists`; missing → new `createId()`, yellow notice, spawn `claude --session-id <newId>`, call `onSessionFallback`; `cancelled` guard in cleanup |
| `src/renderer/src/components/TerminalPane.tsx` | thread `onSessionFallback` prop through to TerminalView |
| `src/renderer/src/App.tsx` | `onSessionFallback={(id, sid) => apply((s) => setTerminalSessionId(s, id, sid))}` |

## Testing

- `transcript.test.ts`: `claudeSessionExists` — existing id file → true;
  missing id file → false; no id + dir with a session → true; no id +
  empty/missing dir → false.
- `TerminalView.test.tsx` (mocked `window.brain`): restored claude terminal
  with a live session → `createPty` gets `claude --resume <id>`, no
  fallback; with a dead session → `createPty` gets
  `claude --session-id <newId>` (a fresh uuid, not the old id) and
  `onSessionFallback` fires with that id; legacy terminal (no sessionId, no
  sessions in cwd) → plain `claude`; codex/shell/fresh mounts spawn
  synchronously, `claudeSessionExists` never called.

// src/main/nodePtySpawner.ts
import * as os from 'os'
import * as pty from 'node-pty'
import type { PtySpawner, PtyHandle } from '@shared/pty'
import { describeDescendants } from './foregroundProc'

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
    onExit: (cb) => { proc.onExit(({ exitCode }) => cb(exitCode)) },
    // Prefer the descendant tree (catches node-wrapped CLIs like codex, whose
    // group-leader argv[0] is just "node"); fall back to node-pty's own value.
    processName: () => {
      if (process.platform === 'linux') {
        const tree = describeDescendants(proc.pid)
        if (tree) return tree
      }
      return proc.process ?? ''
    }
  }
  return handle
}

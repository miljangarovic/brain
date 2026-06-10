import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  summaryCommand, summarizeSession, mapWithLimit, SUMMARY_PROMPT, type SpawnLike
} from './sessionSummary'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill() { this.killed = true }
}

// A SpawnLike whose child is driven by `script` on the next microtask.
function fakeSpawn(script: (child: FakeChild) => void): { spawnFn: SpawnLike; calls: { command: string; args: string[]; cwd: string }[] } {
  const calls: { command: string; args: string[]; cwd: string }[] = []
  const spawnFn: SpawnLike = (command, args, opts) => {
    calls.push({ command, args, cwd: opts.cwd })
    const child = new FakeChild()
    queueMicrotask(() => script(child))
    return child
  }
  return { spawnFn, calls }
}

describe('summaryCommand', () => {
  it('claude: headless resume with the summary prompt', () => {
    expect(summaryCommand('claude', 'sid-1', '/tmp/out.md')).toEqual({
      command: 'claude',
      args: ['-p', '--resume', 'sid-1', SUMMARY_PROMPT]
    })
  })

  it('codex: exec resume writing the last message to a file', () => {
    expect(summaryCommand('codex', 'sid-2', '/tmp/out.md')).toEqual({
      command: 'codex',
      args: ['exec', 'resume', 'sid-2', '--skip-git-repo-check', '--output-last-message', '/tmp/out.md', SUMMARY_PROMPT]
    })
  })
})

describe('summarizeSession', () => {
  it('claude: returns trimmed stdout on exit 0, spawned in the terminal cwd', async () => {
    const { spawnFn, calls } = fakeSpawn((c) => {
      c.stdout.emit('data', '## Summary\n')
      c.stdout.emit('data', 'done\n')
      c.emit('close', 0)
    })
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/proj', spawnFn })
    expect(res).toEqual({ ok: true, markdown: '## Summary\ndone' })
    expect(calls[0].cwd).toBe('/proj')
  })

  it('claude: empty stdout is an error', async () => {
    const { spawnFn } = fakeSpawn((c) => c.emit('close', 0))
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/p', spawnFn })
    expect(res).toEqual({ ok: false, error: 'claude produced no output' })
  })

  it('non-zero exit becomes an error carrying stderr', async () => {
    const { spawnFn } = fakeSpawn((c) => {
      c.stderr.emit('data', 'No conversation found')
      c.emit('close', 2)
    })
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/p', spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('No conversation found')
  })

  it('spawn error (CLI not installed) becomes an error', async () => {
    const { spawnFn } = fakeSpawn((c) => c.emit('error', new Error('spawn claude ENOENT')))
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/p', spawnFn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ENOENT')
  })

  it('times out and kills the child when nothing comes back', async () => {
    let spawned: FakeChild | null = null
    const { spawnFn } = fakeSpawn((c) => { spawned = c /* never closes */ })
    const res = await summarizeSession({ kind: 'claude', sessionId: 's', cwd: '/p', spawnFn, timeoutMs: 20 })
    expect(res).toEqual({ ok: false, error: 'summarization timed out' })
    expect(spawned!.killed).toBe(true)
  })

  it('codex: reads the markdown from the output file and removes it', async () => {
    const out = join(tmpdir(), `brain-sum-test-${Math.random().toString(36).slice(2)}.md`)
    const { spawnFn } = fakeSpawn((c) => {
      void fsp.writeFile(out, '# Codex summary\n').then(() => c.emit('close', 0))
    })
    const res = await summarizeSession({ kind: 'codex', sessionId: 's', cwd: '/p', spawnFn, outputFile: out })
    expect(res).toEqual({ ok: true, markdown: '# Codex summary' })
    await expect(fsp.access(out)).rejects.toThrow()
  })

  it('codex: missing output file is an error', async () => {
    const out = join(tmpdir(), `brain-sum-test-${Math.random().toString(36).slice(2)}.md`)
    const { spawnFn } = fakeSpawn((c) => c.emit('close', 0))
    const res = await summarizeSession({ kind: 'codex', sessionId: 's', cwd: '/p', spawnFn, outputFile: out })
    expect(res).toEqual({ ok: false, error: 'codex wrote no summary file' })
  })

  it('codex: whitespace-only output file is an error', async () => {
    const out = join(tmpdir(), `brain-sum-test-${Math.random().toString(36).slice(2)}.md`)
    const { spawnFn } = fakeSpawn((c) => {
      void fsp.writeFile(out, '  \n').then(() => c.emit('close', 0))
    })
    const res = await summarizeSession({ kind: 'codex', sessionId: 's', cwd: '/p', spawnFn, outputFile: out })
    expect(res).toEqual({ ok: false, error: 'codex produced no output' })
    await fsp.rm(out, { force: true })
  })
})

describe('mapWithLimit', () => {
  it('preserves order and never exceeds the limit', async () => {
    let running = 0
    let peak = 0
    const delays = [30, 10, 20, 5, 15]
    const out = await mapWithLimit(delays, 2, async (ms, i) => {
      running++; peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, ms))
      running--
      return i
    })
    expect(out).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBeLessThanOrEqual(2)
  })
})

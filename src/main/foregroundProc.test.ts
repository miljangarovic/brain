import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import { describeDescendants } from './foregroundProc'

// These assert the Linux /proc behaviour the live-agent icon relies on. node-pty
// only reports the foreground group-leader's argv[0] (e.g. "node" for a node-
// wrapped CLI like codex); walking the descendant tree recovers the real command.
describe('describeDescendants (linux /proc)', () => {
  it('includes a child process command of the given pid', async () => {
    if (process.platform !== 'linux') return
    const child = spawn('sleep', ['5'])
    try {
      await new Promise((r) => setTimeout(r, 150))
      const desc = describeDescendants(process.pid)
      expect(desc).toContain('sleep')
    } finally {
      child.kill()
    }
  })

  it('returns empty string for a pid with no children', () => {
    if (process.platform !== 'linux') return
    // A freshly-reaped/non-existent pid has no children file → empty.
    expect(describeDescendants(2_147_483_000)).toBe('')
  })
})

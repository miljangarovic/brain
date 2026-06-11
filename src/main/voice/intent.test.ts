import { describe, it, expect, vi } from 'vitest'
import { aliasSnapshot, buildIntentMessages, parseIntentResponse, parseIntent, VoiceIntentError } from './intent'
import type { WorkspaceSnapshot } from '@shared/voice'

const snap: WorkspaceSnapshot = {
  groups: [{
    id: 'g1', name: 'mappit', features: [{
      id: 'f1', name: 'file-panes', terminals: [
        { id: 't1', name: 'claude', kind: 'claude' },
        { id: 't2', name: 'shell', kind: 'shell', hidden: true }
      ]
    }]
  }],
  activeFeatureId: 'f1',
  activeTerminalId: 't1'
}

describe('buildIntentMessages', () => {
  it('teaches the batch-2 actions and their fields', () => {
    const [system] = buildIntentMessages('x', snap)
    for (const a of ['cycle_tab', 'close_tabs', 'add_feature', 'archive_feature',
                     'review_accept', 'review_more_rounds', 'review_stop']) {
      expect(system.content).toContain(a)
    }
    expect(system.content).toContain('"direction"')
    expect(system.content).toContain('"scope"')
    expect(system.content).toContain('"groupId"')
  })

  it('embeds snapshot ids/names, active ids, hidden flags and the transcript', () => {
    const [system, user] = buildIntentMessages('prebaci na file panes', snap)
    expect(system.role).toBe('system')
    expect(system.content).toContain('"f1"')
    expect(system.content).toContain('file-panes')
    expect(system.content).toContain('switch_feature')
    expect(system.content).toContain('send_prompt')
    expect(system.content).toContain('hidden')
    expect(system.content).toContain('activeFeatureId')
    expect(user.role).toBe('user')
    expect(user.content).toContain('prebaci na file panes')
  })
})

const uuidSnap: WorkspaceSnapshot = {
  groups: [{
    id: 'd174078d-8e32-4c20-b82d-2ae227381faf', name: 'mappit', features: [{
      id: 'aaaa1111-2222-3333-4444-555566667777', name: 'file-panes', terminals: [
        { id: 'bbbb1111-2222-3333-4444-555566667777', name: 'claude', kind: 'claude' },
        { id: 'cccc1111-2222-3333-4444-555566667777', name: 'shell', kind: 'shell', hidden: true }
      ]
    }]
  }],
  activeFeatureId: 'aaaa1111-2222-3333-4444-555566667777',
  activeTerminalId: 'bbbb1111-2222-3333-4444-555566667777'
}

describe('aliasSnapshot', () => {
  it('replaces UUIDs with short aliases and keeps names/kinds/hidden', () => {
    const { aliased } = aliasSnapshot(uuidSnap)
    expect(aliased.groups[0].id).toBe('g1')
    expect(aliased.groups[0].features[0].id).toBe('f1')
    expect(aliased.groups[0].features[0].terminals.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(aliased.groups[0].features[0].terminals[1].hidden).toBe(true)
    expect(aliased.groups[0].name).toBe('mappit')
  })
  it('aliases the active ids consistently', () => {
    const { aliased } = aliasSnapshot(uuidSnap)
    expect(aliased.activeFeatureId).toBe('f1')
    expect(aliased.activeTerminalId).toBe('t1')
  })
  it('toReal maps every alias back to its UUID', () => {
    const { toReal } = aliasSnapshot(uuidSnap)
    expect(toReal['f1']).toBe('aaaa1111-2222-3333-4444-555566667777')
    expect(toReal['t2']).toBe('cccc1111-2222-3333-4444-555566667777')
    expect(toReal['g1']).toBe('d174078d-8e32-4c20-b82d-2ae227381faf')
  })
})

describe('parseIntentResponse', () => {
  it('parses plain JSON', () => {
    expect(parseIntentResponse('{"action":"toggle_grid","featureId":"f1","confidence":"high"}'))
      .toEqual({ action: 'toggle_grid', featureId: 'f1', confidence: 'high' })
  })
  it('strips markdown fences', () => {
    expect(parseIntentResponse('```json\n{"action":"switch_tab","terminalId":"t1","confidence":"high"}\n```').action)
      .toBe('switch_tab')
  })
  it('garbage → unknown/low', () => {
    expect(parseIntentResponse('not json at all')).toEqual({ action: 'unknown', confidence: 'low' })
  })
})

describe('parseIntent', () => {
  const ok = (content: string) => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  }) as unknown as Response

  it('posts to groq with json mode and returns the validated command', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('{"action":"switch_feature","featureId":"f1","confidence":"high"}'))
    const cmd = await parseIntent({ transcript: 'prebaci na file panes', snapshot: snap, apiKey: 'gsk_x', model: 'llama-3.3-70b-versatile', fetchImpl })
    expect(cmd).toEqual({ action: 'switch_feature', featureId: 'f1', confidence: 'high' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.temperature).toBe(0)
    expect(body.model).toBe('llama-3.3-70b-versatile')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer gsk_x' })
  })
  it('the LLM sees aliases (never UUIDs) in a COMPACT snapshot, and answers translate back to real ids', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('{"action":"switch_feature","featureId":"f1","confidence":"high"}'))
    const cmd = await parseIntent({ transcript: 'prebaci na file panes', snapshot: uuidSnap, apiKey: 'k', model: 'm', fetchImpl })
    expect(cmd.featureId).toBe('aaaa1111-2222-3333-4444-555566667777')
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    const system = body.messages[0].content as string
    expect(system).toContain('"id":"g1"')
    expect(system).toContain('"groups":[{"id":"g1"')          // compact, not pretty-printed
    expect(system).not.toContain('d174078d-8e32-4c20-b82d')   // no UUIDs reach the LLM
  })
  it('an alias the map does not know passes through untouched (stale-id path)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok('{"action":"switch_tab","terminalId":"t99","confidence":"high"}'))
    const cmd = await parseIntent({ transcript: 'x', snapshot: uuidSnap, apiKey: 'k', model: 'm', fetchImpl })
    expect(cmd.terminalId).toBe('t99')
  })
  it('429 → rate-limit error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response)
    await expect(parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl }))
      .rejects.toMatchObject({ kind: 'rate-limit' })
  })
  it("429 surfaces Groq's own reason and retry time instead of an invented one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 429,
      text: async () => JSON.stringify({ error: { message: 'Rate limit reached for model m on tokens per minute (TPM): Limit 12000. Please try again in 7.66s.' } }),
      headers: { get: (h: string) => (h === 'retry-after' ? '8' : null) }
    } as unknown as Response)
    await expect(parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl }))
      .rejects.toMatchObject({ kind: 'rate-limit', message: expect.stringContaining('7.66s') })
  })
  it('401/403 → auth error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response)
    await expect(parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl }))
      .rejects.toMatchObject({ kind: 'auth' })
    const fetch403 = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response)
    await expect(parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl: fetch403 }))
      .rejects.toMatchObject({ kind: 'auth' })
  })
  it('abort → timeout error', async () => {
    const fetchImpl = vi.fn().mockImplementation((_u, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    )
    const promise = parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl, timeoutMs: 20 })
    promise.catch(() => {})
    await expect(promise).rejects.toBeInstanceOf(VoiceIntentError)
    await expect(promise).rejects.toMatchObject({ kind: 'timeout' })
  })
})

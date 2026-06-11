import { describe, it, expect, vi } from 'vitest'
import { buildIntentMessages, parseIntentResponse, parseIntent, VoiceIntentError } from './intent'
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
  it('embeds snapshot ids/names, active ids, hidden flags and the transcript', () => {
    const [system, user] = buildIntentMessages('prebaci na file panes', snap)
    expect(system.role).toBe('system')
    expect(system.content).toContain('"f1"')
    expect(system.content).toContain('file-panes')
    expect(system.content).toContain('switch_feature')
    expect(system.content).toContain('hidden')
    expect(system.content).toContain('activeFeatureId')
    expect(user.role).toBe('user')
    expect(user.content).toContain('prebaci na file panes')
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
  it('429 → rate-limit error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response)
    await expect(parseIntent({ transcript: 'x', snapshot: snap, apiKey: 'k', model: 'm', fetchImpl }))
      .rejects.toMatchObject({ kind: 'rate-limit' })
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

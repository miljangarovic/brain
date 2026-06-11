import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { createTranscriber, libDirFromEntry, type ChildLike } from './transcriber'

class FakeChild extends EventEmitter implements ChildLike {
  sent: { id: number; wavPath: string }[] = []
  postMessage(msg: unknown): void { this.sent.push(msg as { id: number; wavPath: string }) }
  kill(): boolean { this.emit('exit', 0); return true }
  reply(id: number, text: string) { this.emit('message', { id, ok: true, text }) }
  fail(id: number, error: string) { this.emit('message', { id, ok: false, error }) }
}

describe('createTranscriber', () => {
  it('forwards a request and resolves with the child text', async () => {
    const child = new FakeChild()
    const t = createTranscriber({ childPath: '/x', forkImpl: () => child })
    const p = t.transcribe({ wavPath: '/tmp/a.wav', modelPath: '/m.bin', language: 'sr' })
    expect(child.sent[0].wavPath).toBe('/tmp/a.wav')
    child.reply(child.sent[0].id, 'prebaci na grid')
    await expect(p).resolves.toBe('prebaci na grid')
  })
  it('rejects when the child reports an error', async () => {
    const child = new FakeChild()
    const t = createTranscriber({ childPath: '/x', forkImpl: () => child })
    const p = t.transcribe({ wavPath: '/a.wav', modelPath: '/m.bin', language: 'sr' })
    child.fail(child.sent[0].id, 'model load failed')
    await expect(p).rejects.toThrow(/model load failed/)
  })
  it('serializes concurrent requests (one in flight)', async () => {
    const child = new FakeChild()
    const t = createTranscriber({ childPath: '/x', forkImpl: () => child })
    const p1 = t.transcribe({ wavPath: '/1.wav', modelPath: '/m.bin', language: 'sr' })
    const p2 = t.transcribe({ wavPath: '/2.wav', modelPath: '/m.bin', language: 'sr' })
    expect(child.sent).toHaveLength(1)
    child.reply(child.sent[0].id, 'one')
    await expect(p1).resolves.toBe('one')
    expect(child.sent).toHaveLength(2)
    child.reply(child.sent[1].id, 'two')
    await expect(p2).resolves.toBe('two')
  })
  it('child exit rejects the pending request and respawns on next call', async () => {
    const children: FakeChild[] = []
    const forkImpl = vi.fn(() => { const c = new FakeChild(); children.push(c); return c })
    const t = createTranscriber({ childPath: '/x', forkImpl })
    const p = t.transcribe({ wavPath: '/1.wav', modelPath: '/m.bin', language: 'sr' })
    children[0].emit('exit', 1)
    await expect(p).rejects.toThrow(/exited/)
    const p2 = t.transcribe({ wavPath: '/2.wav', modelPath: '/m.bin', language: 'sr' })
    expect(forkImpl).toHaveBeenCalledTimes(2)
    children[1].reply(children[1].sent[0].id, 'ok')
    await expect(p2).resolves.toBe('ok')
  })
  it('child exit rejects queued requests too and does not fork a replacement', async () => {
    const children: FakeChild[] = []
    const forkImpl = vi.fn(() => { const c = new FakeChild(); children.push(c); return c })
    const t = createTranscriber({ childPath: '/x', forkImpl })
    const p1 = t.transcribe({ wavPath: '/1.wav', modelPath: '/m.bin', language: 'sr' })
    const p2 = t.transcribe({ wavPath: '/2.wav', modelPath: '/m.bin', language: 'sr' })  // queued
    children[0].emit('exit', 1)
    await expect(p1).rejects.toThrow(/exited/)
    await expect(p2).rejects.toThrow(/exited/)
    expect(forkImpl).toHaveBeenCalledTimes(1)   // no zombie respawn from the exit handler
  })
  it('a rejected request does not stall the queue', async () => {
    const child = new FakeChild()
    const t = createTranscriber({ childPath: '/x', forkImpl: () => child })
    const p1 = t.transcribe({ wavPath: '/1.wav', modelPath: '/m.bin', language: 'sr' })
    const p2 = t.transcribe({ wavPath: '/2.wav', modelPath: '/m.bin', language: 'sr' })
    child.fail(child.sent[0].id, 'boom')
    await expect(p1).rejects.toThrow(/boom/)
    expect(child.sent).toHaveLength(2)          // p2 dispatched after p1 settled
    child.reply(child.sent[1].id, 'ok')
    await expect(p2).resolves.toBe('ok')
  })
  it('dispose rejects everything and blocks later calls', async () => {
    const children: FakeChild[] = []
    const forkImpl = vi.fn(() => { const c = new FakeChild(); children.push(c); return c })
    const t = createTranscriber({ childPath: '/x', forkImpl })
    const p1 = t.transcribe({ wavPath: '/1.wav', modelPath: '/m.bin', language: 'sr' })
    const p2 = t.transcribe({ wavPath: '/2.wav', modelPath: '/m.bin', language: 'sr' })  // queued
    t.dispose()
    await expect(p1).rejects.toThrow(/disposed|exited/)
    await expect(p2).rejects.toThrow(/disposed|exited/)
    await expect(t.transcribe({ wavPath: '/3.wav', modelPath: '/m.bin', language: 'sr' })).rejects.toThrow(/disposed/)
    expect(forkImpl).toHaveBeenCalledTimes(1)   // dispose never forks
  })
})

describe('libDirFromEntry', () => {
  const suffix = `dist/${process.platform}-${process.arch}`
  it('dev path: lib dir is dist/<platform>-<arch> next to dist/js', () => {
    expect(libDirFromEntry('/repo/node_modules/@kutalia/whisper-node-addon/dist/js/index.js'))
      .toBe(`/repo/node_modules/@kutalia/whisper-node-addon/${suffix}`)
  })
  it('packaged path: app.asar rewritten to app.asar.unpacked (ld.so reads real files only)', () => {
    expect(libDirFromEntry('/opt/Brain/resources/app.asar/node_modules/@kutalia/whisper-node-addon/dist/js/index.js'))
      .toBe(`/opt/Brain/resources/app.asar.unpacked/node_modules/@kutalia/whisper-node-addon/${suffix}`)
  })
})

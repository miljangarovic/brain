import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveExistingPaths } from './pathLinks'

const mktmp = async () => {
  const dir = join(tmpdir(), `brain-links-${Math.random().toString(36).slice(2)}`)
  await fs.mkdir(join(dir, 'src'), { recursive: true })
  await fs.writeFile(join(dir, 'src', 'a.ts'), 'x', 'utf8')
  return dir
}

describe('resolveExistingPaths', () => {
  it('resolves relative candidates against the cwd and keeps only existing ones', async () => {
    const cwd = await mktmp()
    const res = await resolveExistingPaths(cwd, ['src/a.ts', 'src/missing.ts'])
    expect(res).toEqual([join(cwd, 'src', 'a.ts'), null])
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('keeps absolute candidates as-is when they exist', async () => {
    const cwd = await mktmp()
    const abs = join(cwd, 'src', 'a.ts')
    expect(await resolveExistingPaths('/somewhere/else', [abs])).toEqual([abs])
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('expands ~/ against the home dir', async () => {
    const home = await mktmp()
    expect(await resolveExistingPaths('/x', ['~/src/a.ts'], home)).toEqual([join(home, 'src', 'a.ts')])
    await fs.rm(home, { recursive: true, force: true })
  })

  it('resolves against the home dir when cwd is empty (home-dir terminals)', async () => {
    const home = await mktmp()
    expect(await resolveExistingPaths('', ['src/a.ts'], home)).toEqual([join(home, 'src', 'a.ts')])
    await fs.rm(home, { recursive: true, force: true })
  })
})

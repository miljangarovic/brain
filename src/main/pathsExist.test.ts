import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathsExist } from './pathsExist'

describe('pathsExist', () => {
  it('returns index-aligned booleans; errors read as false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-exists-'))
    const real = join(dir, 'spec.md')
    writeFileSync(real, '# spec')
    await expect(pathsExist([real, join(dir, 'missing.md'), real])).resolves.toEqual([true, false, true])
  })

  it('handles the empty list', async () => {
    await expect(pathsExist([])).resolves.toEqual([])
  })
})

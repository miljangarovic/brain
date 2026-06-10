import { promises as fsp } from 'fs'

// Index-aligned existence check for the renderer's document rows. Any access
// error (missing, permission) reads as "does not exist" — the UI only dims the row.
export function pathsExist(paths: string[]): Promise<boolean[]> {
  return Promise.all(paths.map((p) => fsp.access(p).then(() => true, () => false)))
}

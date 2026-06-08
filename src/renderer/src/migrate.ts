import { Workspace, Group, Feature, Terminal } from '@shared/types'
import { createId } from '@shared/id'

// Upgrades a parsed-from-disk workspace to the current shape. Old saves stored
// terminals directly on a group (`group.terminals` + optional `group.viewMode`);
// those become a single default "general" feature. New saves pass through.
export function migrateWorkspace(raw: unknown): Workspace {
  const r = raw as { groups?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.groups)) return { groups: [] }

  const groups = r.groups.map((gv): Group => {
    const g = gv as Record<string, unknown>
    const cwd = typeof g.cwd === 'string' ? g.cwd : ''
    const collapsed = !!g.collapsed
    if (Array.isArray(g.features)) {
      return { id: g.id as string, name: g.name as string, cwd, collapsed, features: g.features as Feature[] }
    }
    const terminals = (Array.isArray(g.terminals) ? g.terminals : []) as Terminal[]
    const feature: Feature = {
      id: createId(),
      name: 'general',
      collapsed: false,
      viewMode: g.viewMode as ('tabs' | 'grid' | undefined),
      terminals
    }
    return { id: g.id as string, name: g.name as string, cwd, collapsed, features: [feature] }
  })
  return { groups }
}

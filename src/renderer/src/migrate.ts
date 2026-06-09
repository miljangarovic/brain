import { Workspace, Group, Feature, Terminal } from '@shared/types'
import { createId } from '@shared/id'

// A persisted review link from before the pipeline rework has `reviewKind` and no
// `phase`. Drop it so the terminal returns to a plain terminal; keep new-shape links.
function sanitizeTerminal(t: Terminal): Terminal {
  const r = (t as { review?: Record<string, unknown> }).review
  if (r && typeof r === 'object' && !('phase' in r)) {
    const { review: _drop, ...rest } = t as Terminal & { review?: unknown }
    return rest as Terminal
  }
  return t
}

function sanitizeFeature(f: Feature): Feature {
  return { ...f, terminals: (f.terminals ?? []).map(sanitizeTerminal) }
}

// Upgrades a parsed-from-disk workspace to the current shape. Old saves stored
// terminals directly on a group (`group.terminals` + optional `group.viewMode`);
// those become a single default "general" feature. Legacy review links are stripped.
export function migrateWorkspace(raw: unknown): Workspace {
  const r = raw as { groups?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.groups)) return { groups: [] }

  const groups = r.groups.map((gv): Group => {
    const g = gv as Record<string, unknown>
    const cwd = typeof g.cwd === 'string' ? g.cwd : ''
    const collapsed = !!g.collapsed
    if (Array.isArray(g.features)) {
      return { id: g.id as string, name: g.name as string, cwd, collapsed, features: (g.features as Feature[]).map(sanitizeFeature) }
    }
    const terminals = (Array.isArray(g.terminals) ? g.terminals : []) as Terminal[]
    const feature: Feature = {
      id: createId(),
      name: 'general',
      collapsed: false,
      viewMode: g.viewMode as ('tabs' | 'grid' | undefined),
      terminals: terminals.map(sanitizeTerminal)
    }
    return { id: g.id as string, name: g.name as string, cwd, collapsed, features: [feature] }
  })
  return { groups }
}

import { Workspace, Group, Feature, Terminal } from '@shared/types'
import { createId } from '@shared/id'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)

// A persisted review link from before the pipeline rework has `reviewKind` and no
// `phase`. Drop it so the terminal returns to a plain terminal; keep new-shape links.
// Garbage entries (corrupt/hand-edited saves) become null and are filtered out;
// missing ids/names are filled in so selection and PTY reaping keep working.
function sanitizeTerminal(tv: unknown): Terminal | null {
  if (!isObj(tv)) return null
  const t = tv as unknown as Terminal
  const base: Terminal = { ...t, id: str(t.id, createId()), name: str(t.name, 'shell'), cwd: str(t.cwd, '') }
  const r = (t as { review?: Record<string, unknown> }).review
  if (r && typeof r === 'object' && !('phase' in r)) {
    const { review: _drop, ...rest } = base
    return rest as Terminal
  }
  return base
}

function sanitizeFeature(fv: unknown): Feature | null {
  if (!isObj(fv)) return null
  const f = fv as unknown as Feature
  return {
    ...f,
    id: str(f.id, createId()),
    name: str(f.name, 'general'),
    collapsed: !!f.collapsed,
    terminals: (Array.isArray(f.terminals) ? f.terminals : []).map(sanitizeTerminal).filter((t): t is Terminal => t !== null)
  }
}

// Upgrades a parsed-from-disk workspace to the current shape. Old saves stored
// terminals directly on a group (`group.terminals` + optional `group.viewMode`);
// those become a single default "general" feature. Legacy review links are stripped.
export function migrateWorkspace(raw: unknown): Workspace {
  const r = raw as { groups?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.groups)) return { groups: [] }

  const groups = r.groups.filter(isObj).map((g): Group => {
    const id = str(g.id, createId())
    const name = str(g.name, 'untitled')
    const cwd = str(g.cwd, '')
    const collapsed = !!g.collapsed
    if (Array.isArray(g.features)) {
      return { id, name, cwd, collapsed, features: g.features.map(sanitizeFeature).filter((f): f is Feature => f !== null) }
    }
    const feature: Feature = {
      id: createId(),
      name: 'general',
      collapsed: false,
      viewMode: g.viewMode as ('tabs' | 'grid' | undefined),
      terminals: (Array.isArray(g.terminals) ? g.terminals : []).map(sanitizeTerminal).filter((t): t is Terminal => t !== null)
    }
    return { id, name, cwd, collapsed, features: [feature] }
  })
  return { groups }
}

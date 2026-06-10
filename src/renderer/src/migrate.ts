import { Workspace, Group, Feature, Terminal, FeatureDoc, FilePane } from '@shared/types'
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

// A document reference is only useful with a path; entries without one are
// dropped. Missing ids/names are filled (name falls back to the file's basename).
function sanitizeDoc(dv: unknown): FeatureDoc | null {
  if (!isObj(dv)) return null
  const d = dv as unknown as FeatureDoc
  if (typeof d.path !== 'string' || !d.path) return null
  return { id: str(d.id, createId()), name: str(d.name, d.path.split('/').pop() || 'doc'), path: d.path }
}

// An open-file pane needs a path; entries without one are dropped. Missing
// ids/names are filled; mdView is kept only when it is a known value.
function sanitizeFilePane(pv: unknown): FilePane | null {
  if (!isObj(pv)) return null
  const p = pv as unknown as FilePane
  if (typeof p.path !== 'string' || !p.path) return null
  return {
    id: str(p.id, createId()),
    name: str(p.name, p.path.split('/').pop() || 'file'),
    path: p.path,
    ...(p.mdView === 'rendered' || p.mdView === 'raw' ? { mdView: p.mdView } : {})
  }
}

function sanitizeFeature(fv: unknown): Feature | null {
  if (!isObj(fv)) return null
  const f = fv as unknown as Feature
  const { documents: _rawDocs, files: _rawFiles, ...rest } = f
  const docs = (Array.isArray(f.documents) ? f.documents : []).map(sanitizeDoc).filter((d): d is FeatureDoc => d !== null)
  const files = (Array.isArray(f.files) ? f.files : []).map(sanitizeFilePane).filter((p): p is FilePane => p !== null)
  return {
    ...rest,
    id: str(f.id, createId()),
    name: str(f.name, 'general'),
    collapsed: !!f.collapsed,
    terminals: (Array.isArray(f.terminals) ? f.terminals : []).map(sanitizeTerminal).filter((t): t is Terminal => t !== null),
    ...(docs.length > 0 ? { documents: docs } : {}),
    ...(files.length > 0 ? { files } : {})
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
      const archived = (Array.isArray(g.archivedFeatures) ? g.archivedFeatures : [])
        .map(sanitizeFeature).filter((f): f is Feature => f !== null)
      return {
        id, name, cwd, collapsed,
        features: g.features.map(sanitizeFeature).filter((f): f is Feature => f !== null),
        ...(archived.length > 0 ? { archivedFeatures: archived } : {})
      }
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

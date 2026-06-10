import { describe, it, expect } from 'vitest'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed, moveGroup,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode, setFeatureGridStyle, moveFeature,
  addTerminal, renameTerminal, removeTerminal, hideTerminal, showTerminal, isHidden, moveTerminal,
  setActiveGroup, setActiveFeature, setActiveTerminal,
  getActiveGroup, getActiveFeature, getActiveTerminal, allTerminals,
  patchReviewLink, findReviewerFor, featureIdOfTerminal, getTerminalById,
  addImportedGroup, addImportedFeature
} from './store'
import type { Group, Feature } from '@shared/types'
import { migrateWorkspace } from './migrate'

const firstGroup = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0]
const firstFeature = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0].features[0]

describe('store reducers', () => {
  it('addGroup creates a group with cwd + a default "general" feature, both active', () => {
    const s = addGroup(createInitialState(), 'proj', '/home/me/proj')
    const g = firstGroup(s)
    expect(g.name).toBe('proj')
    expect(g.cwd).toBe('/home/me/proj')
    expect(g.features).toHaveLength(1)
    expect(g.features[0].name).toBe('general')
    expect(s.activeGroupId).toBe(g.id)
    expect(s.activeFeatureId).toBe(g.features[0].id)
    expect(s.activeTerminalId).toBeNull()
  })

  it('renameGroup / toggleGroupCollapsed', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = renameGroup(s, gid, 'b')
    expect(firstGroup(s).name).toBe('b')
    s = toggleGroupCollapsed(s, gid)
    expect(firstGroup(s).collapsed).toBe(true)
  })

  it('addFeature appends a feature and activates it', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'auth')
    expect(firstGroup(s).features).toHaveLength(2)
    const auth = firstGroup(s).features[1]
    expect(auth.name).toBe('auth')
    expect(s.activeFeatureId).toBe(auth.id)
    expect(s.activeTerminalId).toBeNull()
  })

  it('setFeatureGridStyle sets the persisted grid style on the feature', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    expect(firstFeature(s).gridStyle).toBeUndefined()
    s = setFeatureGridStyle(s, fid, 'rows')
    expect(firstFeature(s).gridStyle).toBe('rows')
    s = setFeatureGridStyle(s, fid, 'auto-left')
    expect(firstFeature(s).gridStyle).toBe('auto-left')
  })

  it('renameFeature / toggleFeatureCollapsed / toggleFeatureViewMode', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = renameFeature(s, fid, 'core')
    expect(firstFeature(s).name).toBe('core')
    s = toggleFeatureCollapsed(s, fid)
    expect(firstFeature(s).collapsed).toBe(true)
    expect(firstFeature(s).viewMode).toBeUndefined()
    s = toggleFeatureViewMode(s, fid)
    expect(firstFeature(s).viewMode).toBe('grid')
    s = toggleFeatureViewMode(s, fid)
    expect(firstFeature(s).viewMode).toBe('tabs')
  })

  it('toggleFeatureViewMode focuses the first terminal when the grid is closed', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 't1' })
    const firstId = firstFeature(s).terminals[0].id
    s = addTerminal(s, fid, { name: 't2' })
    const secondId = firstFeature(s).terminals[1].id

    // Open the grid, then make the second terminal active inside it.
    s = toggleFeatureViewMode(s, fid)
    s = setActiveTerminal(s, secondId)
    expect(s.activeTerminalId).toBe(secondId)

    // Closing the grid collapses to a single tab — the first terminal.
    s = toggleFeatureViewMode(s, fid)
    expect(firstFeature(s).viewMode).toBe('tabs')
    expect(s.activeTerminalId).toBe(firstId)
  })

  it('addTerminal puts the terminal in the feature and inherits the group cwd', () => {
    let s = addGroup(createInitialState(), 'a', '/proj')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'claude', startupCommand: 'claude', kind: 'claude' })
    const t = firstFeature(s).terminals[0]
    expect(t.name).toBe('claude')
    expect(t.cwd).toBe('/proj')
    expect(t.kind).toBe('claude')
    expect(s.activeTerminalId).toBe(t.id)
  })

  it('renameTerminal', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    const tid = firstFeature(s).terminals[0].id
    s = renameTerminal(s, tid, 'y')
    expect(firstFeature(s).terminals[0].name).toBe('y')
  })

  it('removeTerminal selects a sibling within the feature', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    const aId = firstFeature(s).terminals[0].id
    const bId = firstFeature(s).terminals[1].id
    s = setActiveTerminal(s, bId)
    s = removeTerminal(s, bId)
    expect(firstFeature(s).terminals).toHaveLength(1)
    expect(s.activeTerminalId).toBe(aId)
  })

  it('deleteFeature re-selects another feature in the group', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'second')
    const f1 = firstGroup(s).features[0].id
    const f2 = firstGroup(s).features[1].id
    s = setActiveFeature(s, f2)
    s = deleteFeature(s, f2)
    expect(firstGroup(s).features).toHaveLength(1)
    expect(s.activeFeatureId).toBe(f1)
  })

  describe('moveFeature', () => {
    // Build a group with three features: [general, f2, f3].
    const threeFeatures = () => {
      let s = addGroup(createInitialState(), 'a', '')
      const gid = firstGroup(s).id
      s = addFeature(s, gid, 'f2')
      s = addFeature(s, gid, 'f3')
      return { s, gid }
    }
    const names = (s: ReturnType<typeof addGroup>, gi = 0) => s.workspace.groups[gi].features.map((f) => f.name)

    it('moves a feature down to a later index', () => {
      const { s } = threeFeatures()
      const general = firstGroup(s).features[0].id
      const out = moveFeature(s, general, 2)
      expect(names(out)).toEqual(['f2', 'f3', 'general'])
    })

    it('moves a feature up to an earlier index', () => {
      const { s } = threeFeatures()
      const f3 = firstGroup(s).features[2].id
      const out = moveFeature(s, f3, 0)
      expect(names(out)).toEqual(['f3', 'general', 'f2'])
    })

    it('is a no-op when moved to its current index', () => {
      const { s } = threeFeatures()
      const f2 = firstGroup(s).features[1].id
      const out = moveFeature(s, f2, 1)
      expect(names(out)).toEqual(['general', 'f2', 'f3'])
    })

    it('clamps an out-of-range index to the last position', () => {
      const { s } = threeFeatures()
      const general = firstGroup(s).features[0].id
      const out = moveFeature(s, general, 99)
      expect(names(out)).toEqual(['f2', 'f3', 'general'])
    })

    it('leaves features of other groups untouched', () => {
      let { s } = threeFeatures()
      s = addGroup(s, 'b', '')           // second group with its own 'general'
      const other = firstGroup(s).features[0].id // a feature in group 'a'
      const out = moveFeature(s, other, 2)
      expect(names(out, 1)).toEqual(['general']) // group 'b' unchanged
    })

    it('preserves the moved feature\'s terminals', () => {
      let { s } = threeFeatures()
      const f3id = firstGroup(s).features[2].id
      s = addTerminal(s, f3id, { name: 'keep' })
      const out = moveFeature(s, f3id, 0)
      expect(out.workspace.groups[0].features[0].name).toBe('f3')
      expect(out.workspace.groups[0].features[0].terminals.map((t) => t.name)).toEqual(['keep'])
    })

    it('does not change the active selection', () => {
      const { s } = threeFeatures()
      const general = firstGroup(s).features[0].id
      const out = moveFeature(s, general, 2)
      expect(out.activeGroupId).toBe(s.activeGroupId)
      expect(out.activeFeatureId).toBe(s.activeFeatureId)
      expect(out.activeTerminalId).toBe(s.activeTerminalId)
    })

    it('returns state unchanged for an unknown feature id', () => {
      const { s } = threeFeatures()
      expect(moveFeature(s, 'nope', 0)).toBe(s)
    })
  })

  describe('moveGroup', () => {
    // Workspace with three projects: [a, b, c].
    const threeGroups = () => addGroup(addGroup(addGroup(createInitialState(), 'a', ''), 'b', ''), 'c', '')
    const names = (s: ReturnType<typeof addGroup>) => s.workspace.groups.map((g) => g.name)

    it('moves a project down to a later index', () => {
      const s = threeGroups()
      expect(names(moveGroup(s, s.workspace.groups[0].id, 2))).toEqual(['b', 'c', 'a'])
    })

    it('moves a project up to an earlier index', () => {
      const s = threeGroups()
      expect(names(moveGroup(s, s.workspace.groups[2].id, 0))).toEqual(['c', 'a', 'b'])
    })

    it('is a no-op when moved to its current index', () => {
      const s = threeGroups()
      expect(names(moveGroup(s, s.workspace.groups[1].id, 1))).toEqual(['a', 'b', 'c'])
    })

    it('clamps an out-of-range index to the last position', () => {
      const s = threeGroups()
      expect(names(moveGroup(s, s.workspace.groups[0].id, 99))).toEqual(['b', 'c', 'a'])
    })

    it('does not change the active selection', () => {
      const s = threeGroups()
      const out = moveGroup(s, s.workspace.groups[0].id, 2)
      expect(out.activeGroupId).toBe(s.activeGroupId)
      expect(out.activeFeatureId).toBe(s.activeFeatureId)
      expect(out.activeTerminalId).toBe(s.activeTerminalId)
    })

    it('returns state unchanged for an unknown group id', () => {
      const s = threeGroups()
      expect(moveGroup(s, 'nope', 0)).toBe(s)
    })
  })

  describe('moveTerminal', () => {
    // One feature with three terminals: [t1, t2, t3].
    const threeTerminals = () => {
      let s = addGroup(createInitialState(), 'a', '')
      const fid = firstGroup(s).features[0].id
      s = addTerminal(s, fid, { name: 't1' })
      s = addTerminal(s, fid, { name: 't2' })
      s = addTerminal(s, fid, { name: 't3' })
      return { s, fid }
    }
    const termNames = (s: ReturnType<typeof addGroup>) => firstGroup(s).features[0].terminals.map((t) => t.name)

    it('moves a terminal down to a later index', () => {
      const { s } = threeTerminals()
      expect(termNames(moveTerminal(s, firstGroup(s).features[0].terminals[0].id, 2))).toEqual(['t2', 't3', 't1'])
    })

    it('moves a terminal up to an earlier index', () => {
      const { s } = threeTerminals()
      expect(termNames(moveTerminal(s, firstGroup(s).features[0].terminals[2].id, 0))).toEqual(['t3', 't1', 't2'])
    })

    it('is a no-op when moved to its current index', () => {
      const { s } = threeTerminals()
      expect(termNames(moveTerminal(s, firstGroup(s).features[0].terminals[1].id, 1))).toEqual(['t1', 't2', 't3'])
    })

    it('clamps an out-of-range index to the last position', () => {
      const { s } = threeTerminals()
      expect(termNames(moveTerminal(s, firstGroup(s).features[0].terminals[0].id, 99))).toEqual(['t2', 't3', 't1'])
    })

    it('leaves terminals of other features untouched', () => {
      let { s } = threeTerminals()
      s = addFeature(s, firstGroup(s).id, 'other')
      const otherFid = firstGroup(s).features[1].id
      s = addTerminal(s, otherFid, { name: 'keep' })
      const out = moveTerminal(s, firstGroup(s).features[0].terminals[0].id, 2)
      expect(out.workspace.groups[0].features[1].terminals.map((t) => t.name)).toEqual(['keep'])
    })

    it('does not change the active selection', () => {
      const { s } = threeTerminals()
      const out = moveTerminal(s, firstGroup(s).features[0].terminals[0].id, 2)
      expect(out.activeTerminalId).toBe(s.activeTerminalId)
      expect(out.activeFeatureId).toBe(s.activeFeatureId)
    })

    it('returns state unchanged for an unknown terminal id', () => {
      const { s } = threeTerminals()
      expect(moveTerminal(s, 'nope', 0)).toBe(s)
    })
  })

  it('deleteGroup re-selects another group', () => {
    let s = addGroup(addGroup(createInitialState(), 'g1', ''), 'g2', '')
    const g1 = s.workspace.groups[0].id
    const g2 = s.workspace.groups[1].id
    s = deleteGroup(s, g2)
    expect(s.workspace.groups).toHaveLength(1)
    expect(s.activeGroupId).toBe(g1)
  })

  it('setActiveTerminal sets the owning feature and group too', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    s = addFeature(s, gid, 'f2')
    const f1 = firstGroup(s).features[0].id
    s = addTerminal(s, f1, { name: 't' })
    const tid = firstGroup(s).features[0].terminals[0].id
    s = setActiveFeature(s, firstGroup(s).features[1].id)
    s = setActiveTerminal(s, tid)
    expect(s.activeFeatureId).toBe(f1)
    expect(s.activeGroupId).toBe(gid)
    expect(s.activeTerminalId).toBe(tid)
  })

  it('selectors + allTerminals', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    expect(getActiveGroup(s)?.name).toBe('a')
    expect(getActiveFeature(s)?.id).toBe(fid)
    expect(getActiveTerminal(s)?.name).toBe('x')
    expect(allTerminals(s)).toHaveLength(1)
  })

  it('createInitialState picks first group/feature/terminal from a migrated workspace', () => {
    const ws = migrateWorkspace({ groups: [{ id: 'g', name: 'G', collapsed: false, terminals: [{ id: 't', name: 'x', cwd: '' }] }] })
    const s = createInitialState(ws)
    expect(s.activeGroupId).toBe('g')
    expect(s.activeFeatureId).toBe(ws.groups[0].features[0].id)
    expect(s.activeTerminalId).toBe('t')
  })

  it('hideTerminal hides it (slot kept) and moves active to a visible sibling', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    const aId = firstFeature(s).terminals[0].id
    const bId = firstFeature(s).terminals[1].id
    s = setActiveTerminal(s, bId)
    s = hideTerminal(s, bId)
    expect(isHidden(s, bId)).toBe(true)
    expect(s.workspace.groups[0].features[0].terminals).toHaveLength(2) // slot kept
    expect(s.activeTerminalId).toBe(aId)                                // moved to visible sibling
  })

  it('showTerminal un-hides it and activates it', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    const tid = firstFeature(s).terminals[0].id
    s = hideTerminal(s, tid)
    expect(isHidden(s, tid)).toBe(true)
    s = showTerminal(s, tid)
    expect(isHidden(s, tid)).toBe(false)
    expect(s.activeTerminalId).toBe(tid)
  })

  it('removeTerminal prunes the hidden set and skips hidden siblings when re-selecting', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    s = addTerminal(s, fid, { name: 'c' })
    const [aId, bId, cId] = firstFeature(s).terminals.map((t) => t.id)
    s = hideTerminal(s, bId)        // b is hidden
    s = setActiveTerminal(s, cId)
    s = removeTerminal(s, cId)      // delete active c -> must skip hidden b, pick a
    expect(s.activeTerminalId).toBe(aId)
    expect(isHidden(s, bId)).toBe(true)
    s = removeTerminal(s, bId)      // deleting b prunes it from hidden
    expect(isHidden(s, bId)).toBe(false)
  })

  it('entering grid view un-hides every terminal of the feature (X-ed panes return)', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    const bId = firstFeature(s).terminals[1].id
    s = hideTerminal(s, bId)
    s = toggleFeatureViewMode(s, fid)        // tabs -> grid
    expect(firstFeature(s).viewMode).toBe('grid')
    expect(isHidden(s, bId)).toBe(false)
  })

  it('entering grid view leaves other features\' hidden terminals alone', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const gid = firstGroup(s).id
    const f1 = firstFeature(s).id
    s = addFeature(s, gid, 'other')
    const f2 = firstGroup(s).features[1].id
    s = addTerminal(s, f2, { name: 'x' })
    const xId = firstGroup(s).features[1].terminals[0].id
    s = hideTerminal(s, xId)
    s = toggleFeatureViewMode(s, f1)         // grid on the FIRST feature
    expect(isHidden(s, xId)).toBe(true)      // f2's hidden terminal untouched
  })

  it('setActiveFeature skips hidden terminals when picking the active one', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    const [aId, bId] = firstFeature(s).terminals.map((t) => t.id)
    s = hideTerminal(s, aId)
    s = setActiveFeature(s, fid)
    expect(s.activeTerminalId).toBe(bId)
  })

  it('setActiveFeature selects no terminal when every one is hidden', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    const tid = firstFeature(s).terminals[0].id
    s = hideTerminal(s, tid)
    s = setActiveFeature(s, fid)
    expect(s.activeTerminalId).toBeNull()
  })

  it('setActiveGroup skips hidden terminals when picking the active one', () => {
    let s = addGroup(createInitialState(), 'one', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'a' })
    s = addTerminal(s, fid, { name: 'b' })
    const [aId, bId] = firstFeature(s).terminals.map((t) => t.id)
    s = addGroup(s, 'two', '')
    s = hideTerminal(s, aId)
    s = setActiveGroup(s, s.workspace.groups[0].id)
    expect(s.activeTerminalId).toBe(bId)
  })
})

describe('review store', () => {
  const link = (originId: string, round = 1) => ({
    originTerminalId: originId, phase: 'spec' as const, round, maxRounds: 5,
    reviewDir: '/r', specPath: '/a/spec.md', intentPath: '/r/intent.md'
  })

  it('addTerminal can attach a review link', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'review: codex', kind: 'codex', review: link('origin-1') })
    const t = getActiveTerminal(s)!
    expect(t.review?.originTerminalId).toBe('origin-1')
    expect(t.review?.round).toBe(1)
  })

  it('findReviewerFor locates the reviewer of an origin', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'A', kind: 'claude' })
    const aId = getActiveTerminal(s)!.id
    s = addTerminal(s, fid, { name: 'review: codex', kind: 'codex', review: link(aId) })
    const reviewer = findReviewerFor(s, aId)
    expect(reviewer?.name).toBe('review: codex')
    expect(findReviewerFor(s, 'nope')).toBeNull()
  })

  it('patchReviewLink merges fields on a reviewer terminal', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'review: codex', kind: 'codex', review: link('o', 1) })
    const bId = getActiveTerminal(s)!.id
    s = patchReviewLink(s, bId, { phase: 'impl', round: 2 })
    const r = findReviewerFor(s, 'o')?.review
    expect(r?.phase).toBe('impl')
    expect(r?.round).toBe(2)
    expect(r?.maxRounds).toBe(5) // untouched fields preserved
  })

  it('featureIdOfTerminal / getTerminalById resolve a terminal', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'A', kind: 'claude' })
    const aId = getActiveTerminal(s)!.id
    expect(featureIdOfTerminal(s, aId)).toBe(fid)
    expect(getTerminalById(s, aId)?.name).toBe('A')
    expect(featureIdOfTerminal(s, 'x')).toBeNull()
  })

  it('addTerminal uses a provided id when given', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'B', id: 'fixed-id' })
    expect(getTerminalById(s, 'fixed-id')?.name).toBe('B')
  })
})

import { isUnderReview, terminalPath } from './store'

describe('attention store helpers', () => {
  // Build: project "p" › feature "general" › terminals origin + reviewer(origin).
  function withReviewer() {
    let s = addGroup(createInitialState(), 'p', '/tmp')
    const fid = s.activeFeatureId!
    s = addTerminal(s, fid, { id: 'origin', name: 'impl', kind: 'claude' })
    s = addTerminal(s, fid, {
      id: 'rev', name: 'review: codex', kind: 'codex',
      review: { originTerminalId: 'origin', phase: 'impl', round: 1, maxRounds: 5, reviewDir: '/x' }
    })
    return s
  }

  it('isUnderReview is true for a reviewer and its origin', () => {
    const s = withReviewer()
    expect(isUnderReview(s, 'rev')).toBe(true)
    expect(isUnderReview(s, 'origin')).toBe(true)
  })
  it('isUnderReview is false for an unrelated terminal', () => {
    let s = withReviewer()
    s = addTerminal(s, s.activeFeatureId!, { id: 'solo', name: 'solo', kind: 'claude' })
    expect(isUnderReview(s, 'solo')).toBe(false)
  })
  it('terminalPath renders Project › Feature › Terminal', () => {
    const s = withReviewer()
    expect(terminalPath(s, 'origin')).toBe('p › general › impl')
  })
  it('terminalPath is empty for an unknown id', () => {
    expect(terminalPath(createInitialState(), 'nope')).toBe('')
  })
})

describe('addImportedGroup / addImportedFeature', () => {
  const importedGroup: Group = {
    id: 'ig', name: 'imported', cwd: '/p', collapsed: false, features: [
      { id: 'if', name: 'auth', collapsed: false, terminals: [{ id: 'it', name: 'claude', cwd: '/p', kind: 'claude' }] }
    ]
  }
  const importedFeature: Feature = {
    id: 'xf', name: 'payments', collapsed: false, terminals: [{ id: 'xt', name: 'codex', cwd: '/p', kind: 'codex' }]
  }

  it('addImportedGroup appends the group and activates its first feature/terminal', () => {
    let s0 = createInitialState()
    s0 = addGroup(s0, 'existing', '/e')
    const s1 = addImportedGroup(s0, importedGroup)
    expect(s1.workspace.groups.map((g) => g.name)).toEqual(['existing', 'imported'])
    expect(s1.activeGroupId).toBe('ig')
    expect(s1.activeFeatureId).toBe('if')
    expect(s1.activeTerminalId).toBe('it')
  })

  it('addImportedFeature inserts into the active group and activates it', () => {
    let s = createInitialState()
    s = addGroup(s, 'host', '/host')
    const s1 = addImportedFeature(s, importedFeature, { name: 'fallback', cwd: '/fb' })
    const host = s1.workspace.groups.find((g) => g.name === 'host')!
    expect(host.features.map((f) => f.id)).toContain('xf')
    expect(host.collapsed).toBe(false)
    expect(s1.activeFeatureId).toBe('xf')
    expect(s1.activeTerminalId).toBe('xt')
  })

  it('addImportedFeature creates a group from the fallback when the workspace is empty', () => {
    const s1 = addImportedFeature(createInitialState(), importedFeature, { name: 'fallback', cwd: '/fb' })
    expect(s1.workspace.groups).toHaveLength(1)
    expect(s1.workspace.groups[0]).toMatchObject({ name: 'fallback', cwd: '/fb' })
    expect(s1.workspace.groups[0].features.map((f) => f.id)).toEqual(['xf'])
    expect(s1.activeGroupId).toBe(s1.workspace.groups[0].id)
    expect(s1.activeFeatureId).toBe('xf')
  })
})

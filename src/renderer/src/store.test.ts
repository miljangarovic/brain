import { describe, it, expect } from 'vitest'
import {
  createInitialState, addGroup, renameGroup, deleteGroup, toggleGroupCollapsed, moveGroup,
  addFeature, renameFeature, deleteFeature, toggleFeatureCollapsed, toggleFeatureViewMode, setFeatureGridStyle, moveFeature,
  addTerminal, renameTerminal, removeTerminal, hideTerminal, showTerminal, isHidden, moveTerminal,
  setActiveGroup, setActiveFeature, setActiveTerminal,
  getActiveGroup, getActiveFeature, getActiveTerminal, allTerminals,
  patchReviewLink, findReviewersFor, featureIdOfTerminal, getTerminalById,
  addImportedGroup, addImportedFeature, archiveFeature, restoreFeature, deleteArchivedFeature, setTerminalSessionId,
  addDocument, renameDocument, removeDocument,
  openFile, closeFile, moveFile, renameFilePane, setFilePaneMdView, findFilePane,
  visiblePanes, cyclePane
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

  it('showTerminal with an unknown id leaves the state untouched', () => {
    let s = addGroup(createInitialState(), 'a', '')
    const fid = firstFeature(s).id
    s = addTerminal(s, fid, { name: 'x' })
    // e.g. an OS-notification key that is not a terminal ('export:<path>')
    const s1 = showTerminal(s, 'export:/tmp/x.zip')
    expect(s1).toBe(s)
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

  it('findReviewersFor returns every reviewer of an origin, in tree order', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'A', kind: 'claude' })
    const aId = getActiveTerminal(s)!.id
    s = addTerminal(s, fid, { name: 'claude review: A', kind: 'claude', review: link(aId) })
    s = addTerminal(s, fid, { name: 'codex review: A', kind: 'codex', review: link(aId) })
    expect(findReviewersFor(s, aId).map((t) => t.name)).toEqual(['claude review: A', 'codex review: A'])
    expect(findReviewersFor(s, 'nope')).toEqual([])
  })

  it('patchReviewLink merges fields on a reviewer terminal', () => {
    let s = addGroup(createInitialState(), 'g', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'review: codex', kind: 'codex', review: link('o', 1) })
    const bId = getActiveTerminal(s)!.id
    s = patchReviewLink(s, bId, { phase: 'impl', round: 2 })
    const r = findReviewersFor(s, 'o')[0]?.review
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

describe('feature archive', () => {
  // group with two features: f0 'general' (default) + 'auth'; one terminal in 'auth'
  const setup = () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const gid = s.workspace.groups[0].id
    s = addFeature(s, gid, 'auth')
    const fid = s.workspace.groups[0].features[1].id
    s = addTerminal(s, fid, { name: 'term' })
    return { s, gid, fid }
  }

  it('archiveFeature moves the feature into group.archivedFeatures', () => {
    const { s, fid } = setup()
    const out = archiveFeature(s, fid)
    const g = out.workspace.groups[0]
    expect(g.features.map((f) => f.name)).toEqual(['general'])
    expect(g.archivedFeatures!.map((f) => f.name)).toEqual(['auth'])
    expect(g.archivedFeatures![0].terminals).toHaveLength(1) // terminals ride along
  })

  it('archived terminals leave allTerminals (so the PTY reaper kills them)', () => {
    const { s, fid } = setup()
    expect(allTerminals(s)).toHaveLength(1)
    expect(allTerminals(archiveFeature(s, fid))).toHaveLength(0)
  })

  it('archiving the active feature reselects within the group; activeGroupId untouched', () => {
    const { s, gid, fid } = setup() // addTerminal made 'auth' + its terminal active
    const out = archiveFeature(s, fid)
    expect(out.activeGroupId).toBe(gid)
    expect(out.activeFeatureId).toBe(out.workspace.groups[0].features[0].id) // 'general'
    expect(out.activeTerminalId).toBeNull() // 'general' has no terminals
  })

  it('archiving the last active feature leaves null feature/terminal selection', () => {
    let { s, fid } = setup()
    const generalId = s.workspace.groups[0].features[0].id
    s = archiveFeature(s, generalId)
    const out = archiveFeature(s, fid)
    expect(out.workspace.groups[0].features).toHaveLength(0)
    expect(out.activeFeatureId).toBeNull()
    expect(out.activeTerminalId).toBeNull()
    expect(out.activeGroupId).toBe(out.workspace.groups[0].id)
  })

  it('archiving a non-active feature leaves selection untouched', () => {
    const { s, fid } = setup()
    const generalId = s.workspace.groups[0].features[0].id
    const out = archiveFeature(s, generalId)
    expect(out.activeFeatureId).toBe(fid)
    expect(out.activeTerminalId).toBe(s.activeTerminalId)
  })

  it('archiveFeature prunes the feature terminals from hidden', () => {
    let { s, fid } = setup()
    const tid = s.workspace.groups[0].features[1].terminals[0].id
    s = hideTerminal(s, tid)
    expect(isHidden(s, tid)).toBe(true)
    expect(isHidden(archiveFeature(s, fid), tid)).toBe(false)
  })

  it('restoreFeature appends to the END of active features and keeps selection', () => {
    let { s, fid } = setup()
    s = archiveFeature(s, fid)
    const before = { f: s.activeFeatureId, t: s.activeTerminalId }
    const out = restoreFeature(s, fid)
    const g = out.workspace.groups[0]
    expect(g.features.map((f) => f.name)).toEqual(['general', 'auth'])
    expect(g.archivedFeatures).toHaveLength(0)
    expect(g.features[1].terminals).toHaveLength(1)
    expect(out.activeFeatureId).toBe(before.f)
    expect(out.activeTerminalId).toBe(before.t)
  })

  it('deleteArchivedFeature removes it permanently', () => {
    let { s, fid } = setup()
    s = archiveFeature(s, fid)
    const out = deleteArchivedFeature(s, fid)
    expect(out.workspace.groups[0].archivedFeatures).toHaveLength(0)
    expect(out.workspace.groups[0].features.map((f) => f.name)).toEqual(['general'])
  })

  it('archiveFeature / restoreFeature are no-ops for unknown ids', () => {
    const { s } = setup()
    expect(archiveFeature(s, 'nope')).toBe(s)
    expect(restoreFeature(s, 'nope')).toBe(s)
    expect(deleteArchivedFeature(s, 'nope')).toBe(s)
  })

  // launchAgent's captureAgentSession callback can resolve ~15s after launch; if
  // the feature was archived meanwhile, the sessionId must still land — otherwise
  // restore falls back to `codex resume --last` and may grab the wrong session.
  it('setTerminalSessionId reaches archived terminals (codex capture racing an archive)', () => {
    let { s, fid } = setup()
    const tid = s.workspace.groups[0].features[1].terminals[0].id
    s = archiveFeature(s, fid)
    const out = setTerminalSessionId(s, tid, 'sid-late')
    expect(out.workspace.groups[0].archivedFeatures![0].terminals[0].sessionId).toBe('sid-late')
  })
})

describe('feature documents', () => {
  const setup = () => {
    const s = addGroup(createInitialState(), 'proj', '/p')
    return { s, fid: s.workspace.groups[0].features[0].id }
  }
  const docsOf = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0].features[0].documents

  it('addDocument appends a doc with the given id/name/path', () => {
    const { s, fid } = setup()
    const out = addDocument(s, fid, { id: 'd1', name: 'spec.md', path: '/p/spec.md' })
    expect(docsOf(out)).toEqual([{ id: 'd1', name: 'spec.md', path: '/p/spec.md' }])
  })

  it('addDocument generates an id when none is given', () => {
    const { s, fid } = setup()
    const out = addDocument(s, fid, { name: 'spec.md', path: '/p/spec.md' })
    expect(docsOf(out)![0].id).toBeTruthy()
  })

  it('addDocument with an already-referenced path is a no-op', () => {
    let { s, fid } = setup()
    s = addDocument(s, fid, { name: 'spec.md', path: '/p/spec.md' })
    const out = addDocument(s, fid, { name: 'again', path: '/p/spec.md' })
    expect(out).toBe(s)
  })

  it('renameDocument / removeDocument target the doc by id; the path is untouched', () => {
    let { s, fid } = setup()
    s = addDocument(s, fid, { id: 'd1', name: 'spec.md', path: '/p/spec.md' })
    s = addDocument(s, fid, { id: 'd2', name: 'plan.md', path: '/p/plan.md' })
    s = renameDocument(s, fid, 'd1', 'Spec')
    expect(docsOf(s)![0]).toEqual({ id: 'd1', name: 'Spec', path: '/p/spec.md' })
    s = removeDocument(s, fid, 'd1')
    expect(docsOf(s)!.map((d) => d.id)).toEqual(['d2'])
  })

  it('document ops on an archived feature are no-ops (active features only)', () => {
    let { s, fid } = setup()
    s = addDocument(s, fid, { id: 'd1', name: 'spec.md', path: '/p/spec.md' })
    s = archiveFeature(s, fid)
    expect(addDocument(s, fid, { name: 'x', path: '/x' })).toBe(s)
    expect(renameDocument(s, fid, 'd1', 'X').workspace).toEqual(s.workspace)
    expect(removeDocument(s, fid, 'd1').workspace).toEqual(s.workspace)
    // the archived feature still carries its documents
    expect(s.workspace.groups[0].archivedFeatures![0].documents).toHaveLength(1)
  })
})

describe('file panes', () => {
  const setup = () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'term' })
    return { s, fid, tid: s.workspace.groups[0].features[0].terminals[0].id }
  }
  const filesOf = (s: ReturnType<typeof addGroup>) => s.workspace.groups[0].features[0].files

  it('openFile appends a pane (name defaults to basename) and activates it', () => {
    const { s, fid } = setup()
    const out = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    expect(filesOf(out)).toEqual([{ id: 'p1', path: '/p/readme.md', name: 'readme.md' }])
    expect(out.activeTerminalId).toBe('p1')
    expect(out.activeFeatureId).toBe(fid)
  })

  it('openFile with an already-open path just activates the existing pane', () => {
    let { s, fid, tid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    s = setActiveTerminal(s, tid)
    const out = openFile(s, fid, { path: '/p/readme.md' })
    expect(filesOf(out)).toHaveLength(1)
    expect(out.activeTerminalId).toBe('p1')
  })

  it('setActiveTerminal accepts a file pane id and selects its feature', () => {
    let { s, fid, tid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    s = setActiveTerminal(s, tid)
    const out = setActiveTerminal(s, 'p1')
    expect(out.activeTerminalId).toBe('p1')
    expect(out.activeFeatureId).toBe(fid)
  })

  it('closeFile removes the pane; selection falls to the first visible terminal', () => {
    let { s, fid, tid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    const out = closeFile(s, 'p1')
    expect(filesOf(out)).toHaveLength(0)
    expect(out.activeTerminalId).toBe(tid)
  })

  it('closeFile falls back to another file pane when no terminal is visible', () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    s = openFile(s, fid, { id: 'p2', path: '/p/b.md' })
    const out = closeFile(s, 'p2')
    expect(out.activeTerminalId).toBe('p1')
    expect(closeFile(out, 'p1').activeTerminalId).toBeNull()
  })

  it('closeFile of a non-active pane leaves selection untouched; unknown id is a no-op', () => {
    let { s, fid, tid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    s = setActiveTerminal(s, tid)
    expect(closeFile(s, 'p1').activeTerminalId).toBe(tid)
    expect(closeFile(s, 'nope')).toBe(s)
  })

  it('moveFile reorders within the feature; renameFilePane and setFilePaneMdView patch the pane', () => {
    let { s, fid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    s = openFile(s, fid, { id: 'p2', path: '/p/b.md' })
    s = moveFile(s, 'p2', 0)
    expect(filesOf(s)!.map((p) => p.id)).toEqual(['p2', 'p1'])
    s = renameFilePane(s, 'p1', 'Notes')
    s = setFilePaneMdView(s, 'p1', 'raw')
    const p1 = filesOf(s)!.find((p) => p.id === 'p1')!
    expect(p1.name).toBe('Notes')
    expect(p1.mdView).toBe('raw')
  })

  it('findFilePane locates a pane and its feature; archived features carry files along', () => {
    let { s, fid } = setup()
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    expect(findFilePane(s, 'p1')?.feature.id).toBe(fid)
    const archived = archiveFeature(s, fid)
    expect(findFilePane(archived, 'p1')).toBeNull() // active features only
    expect(archived.workspace.groups[0].archivedFeatures![0].files).toHaveLength(1)
  })
})

describe('visiblePanes / cyclePane', () => {
  function fix() {
    let s = createInitialState()
    s = addGroup(s, 'p', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 't1' })
    s = addTerminal(s, fid, { name: 't2' })
    s = openFile(s, fid, { path: '/p/readme.md' })
    const f = s.workspace.groups[0].features[0]
    return { s, fid, t1: f.terminals[0].id, t2: f.terminals[1].id, p1: f.files![0].id }
  }
  it('lists visible terminals then file panes, skipping hidden', () => {
    let { s, t1, t2, p1 } = fix()
    s = hideTerminal(s, t1)
    expect(visiblePanes(s).map((v) => v.id)).toEqual([t2, p1])
    expect(visiblePanes(s).map((v) => v.file)).toEqual([false, true])
  })
  it('visiblePanes takes an explicit featureId', () => {
    const { s, fid, t1, t2, p1 } = fix()
    expect(visiblePanes(s, fid).map((v) => v.id)).toEqual([t1, t2, p1])
  })
  it('cyclePane wraps forward from the last pane to the first', () => {
    let { s, t1, p1 } = fix()
    s = setActiveTerminal(s, p1)
    expect(cyclePane(s, 1)?.id).toBe(t1)
  })
  it('cyclePane steps backward and is null with no visible panes', () => {
    let { s, t2, p1 } = fix()
    s = setActiveTerminal(s, p1)
    expect(cyclePane(s, -1)?.id).toBe(t2)
    let empty = createInitialState()
    empty = addGroup(empty, 'q', '/q')
    expect(cyclePane(empty, 1)).toBeNull()
  })
})

describe('file panes — uniform selection fallback', () => {
  const setupWithFile = () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = addTerminal(s, fid, { name: 'term' })
    const tid = s.workspace.groups[0].features[0].terminals[0].id
    s = openFile(s, fid, { id: 'p1', path: '/p/readme.md' })
    s = setActiveTerminal(s, tid)
    return { s, fid, tid }
  }

  it('hiding the last visible terminal selects the first file pane', () => {
    const { s, tid } = setupWithFile()
    const out = hideTerminal(s, tid)
    expect(out.activeTerminalId).toBe('p1')
  })

  it('hideTerminal is a no-op for file pane ids — they never enter hidden', () => {
    const { s } = setupWithFile()
    const active = setActiveTerminal(s, 'p1')
    const out = hideTerminal(active, 'p1')
    expect(out.hidden).toEqual([])
    expect(out.activeTerminalId).toBe('p1')
  })

  it('removing the last terminal selects the first file pane', () => {
    const { s, tid } = setupWithFile()
    const out = removeTerminal(s, tid)
    expect(out.activeTerminalId).toBe('p1')
  })

  // Two panes with p2 active: the stale-selection fallback in the CURRENT code
  // would keep p2, so this is genuinely red before the fix and pins the rule.
  it('grid→tabs collapse on a terminal-less feature focuses the FIRST file pane', () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    s = openFile(s, fid, { id: 'p2', path: '/p/b.md' }) // active: p2
    s = toggleFeatureViewMode(s, fid)                   // tabs → grid
    expect(toggleFeatureViewMode(s, fid).activeTerminalId).toBe('p1')
  })

  it('setActiveFeature on a terminal-less feature selects its first file pane', () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const fid = s.workspace.groups[0].features[0].id
    s = openFile(s, fid, { id: 'p1', path: '/p/a.md' })
    s = addFeature(s, s.workspace.groups[0].id, 'extra') // selection moves away
    expect(setActiveFeature(s, fid).activeTerminalId).toBe('p1')
  })

  it('selectFeature (via deleteFeature of the active feature) lands on a file-pane-only sibling', () => {
    let s = addGroup(createInitialState(), 'proj', '/p')
    const gid = s.workspace.groups[0].id
    const generalId = s.workspace.groups[0].features[0].id
    s = openFile(s, generalId, { id: 'p1', path: '/p/a.md' })
    s = addFeature(s, gid, 'extra') // active now: 'extra'
    s = deleteFeature(s, s.workspace.groups[0].features[1].id)
    expect(s.activeFeatureId).toBe(generalId)
    expect(s.activeTerminalId).toBe('p1')
  })
})

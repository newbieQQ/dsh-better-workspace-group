/**
 * Tree-derivation tests: the renderer's data-shaping contract — manual
 * overrides win over rules, manual groups render while empty, rule buckets
 * hide while empty, and top-level (ungrouped) workspaces render as separate
 * rows after the group folders (no "未分类" bucket).
 * Pure derivation (no DOM), fixtures cast to the runtime contract types.
 *
 * Every import reached from `tree.ts` is type-only except `indexSubagentDescendants`,
 * which lives in this package (`subagent-lineage.ts`) and needs no stub; the
 * fixtures carry no subagents.
 */
import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { deriveGroups, deriveSearchGroups, deriveTopLevel } from '../src/client/tree.ts'
import type { FoldersDocument } from '../src/core/folders.ts'
import type { GroupsConfig, ManualGroups } from '../src/core/types.ts'

const CONFIG: GroupsConfig = {
  categories: [
    { name: 'DSH 插件', rules: [{ nameContains: '插件' }] },
    { name: '文档', rules: [{ basenameContains: 'docs' }] },
  ],
}

function workspace(id: string, path: string, title: string, sessionIds: string[] = []): WorkspaceView {
  return { workspaceId: id, path, title, createdAt: '2026-01-01T00:00:00.000Z', sessionIds } as unknown as WorkspaceView
}

function session(id: string, title: string): SessionSummary {
  return {
    id,
    origin: 'user',
    blank: false,
    displayTitle: title,
    running: false,
    completed: false,
    updatedAt: 1_700_000_000_000,
    cwd: '/Users/zcol/Project/x',
  } as unknown as SessionSummary
}

function listState(workspaces: WorkspaceView[], current?: string): SessionListState {
  const byId: Record<string, SessionSummary> = {}
  for (const ws of workspaces) {
    for (const id of ws.sessionIds) byId[id] = session(id, `会话-${id}`)
  }
  return {
    ids: Object.keys(byId),
    byId,
    current,
    phase: 'ready',
    subagentsByParent: {},
  } as unknown as SessionListState
}

const VIEW = { expandedCategories: [], expandedWorkspaces: [] }

describe('deriveGroups with the manual overlay', () => {
  const workspaces = [
    workspace('ws-a', '/Users/zcol/Project/SomePlugin', 'DSH插件Demo'),
    workspace('ws-b', '/Users/zcol/Project/MyDocs', 'MyDocs'),
    workspace('ws-c', '/tmp/random', 'Random'),
  ]

  it('groups by rules without an overlay; unmatched workspaces are top-level', () => {
    const groups = deriveGroups(listState(workspaces), workspaces, [], CONFIG, VIEW, { categories: [], assignments: {} })
    const labels = groups.map(g => g.label)
    expect(labels).toEqual(['DSH 插件', '文档'])
    expect(groups[0]?.workspaces.map(w => w.workspaceId)).toEqual(['ws-a'])
    expect(groups[1]?.workspaces.map(w => w.workspaceId)).toEqual(['ws-b'])
    // ws-c matches no rule → top-level, not in any bucket.
    const top = deriveTopLevel(listState(workspaces), workspaces, [], CONFIG, VIEW, { categories: [], assignments: {} })
    expect(top.map(w => w.workspaceId)).toEqual(['ws-c'])
  })

  it('a manual override moves a workspace into a manual group', () => {
    const manual: ManualGroups = { categories: ['临时'], assignments: { 'ws-a': '临时' } }
    const groups = deriveGroups(listState(workspaces), workspaces, [], CONFIG, VIEW, manual)
    const byLabel = new Map(groups.map(g => [g.label, g]))
    expect(byLabel.get('临时')?.workspaces.map(w => w.workspaceId)).toEqual(['ws-a'])
    // ws-a left the rule bucket; with nothing left, the empty rule bucket hides.
    expect(byLabel.has('DSH 插件')).toBe(false)
    expect(byLabel.get('文档')?.workspaces.map(w => w.workspaceId)).toEqual(['ws-b'])
  })

  it('an empty manual group still renders (a new group appears before any drop)', () => {
    const manual: ManualGroups = { categories: ['临时'], assignments: {} }
    const groups = deriveGroups(listState(workspaces), workspaces, [], CONFIG, VIEW, manual)
    const byLabel = new Map(groups.map(g => [g.label, g]))
    expect(byLabel.has('临时')).toBe(true)
    expect(byLabel.get('临时')?.workspaces).toEqual([])
  })

  it('an empty rule bucket stays hidden', () => {
    const manual: ManualGroups = { categories: [], assignments: {} }
    const groups = deriveGroups(listState([]), [], [], CONFIG, VIEW, manual)
    expect(groups).toEqual([])
  })

  it('removing an override reverts to rule classification', () => {
    // ws-a overridden to 临时; override removed → rule classification applies again.
    const withOverride: ManualGroups = { categories: ['临时'], assignments: { 'ws-a': '临时' } }
    const moved = deriveGroups(listState(workspaces), workspaces, [], CONFIG, VIEW, withOverride)
    expect(moved.find(g => g.label === '临时')?.workspaces).toHaveLength(1)

    const reverted: ManualGroups = { categories: ['临时'], assignments: {} }
    const back = deriveGroups(listState(workspaces), workspaces, [], CONFIG, VIEW, reverted)
    expect(back.find(g => g.label === '临时')?.workspaces).toHaveLength(0)
    expect(back.find(g => g.label === 'DSH 插件')?.workspaces.map(w => w.workspaceId)).toEqual(['ws-a'])
  })

  it('a null override forces top-level (rule match ignored)', () => {
    const manual: ManualGroups = { categories: [], assignments: { 'ws-a': null } }
    const groups = deriveGroups(listState(workspaces), workspaces, [], CONFIG, VIEW, manual)
    expect(groups.find(g => g.label === 'DSH 插件')).toBeUndefined()
    const top = deriveTopLevel(listState(workspaces), workspaces, [], CONFIG, VIEW, manual)
    // ws-a forced top-level; ws-c matches no rule and is top-level too.
    expect(top.map(w => w.workspaceId)).toEqual(['ws-a', 'ws-c'])
  })

  it('stored workspace order wins inside a bucket', () => {
    const manual: ManualGroups = {
      categories: [],
      assignments: {},
      workspaceOrder: { 'DSH 插件': ['ws-a2', 'ws-a1'] },
    }
    const ws = [
      workspace('ws-a1', '/Users/zcol/Project/AA', '插件A1'),
      workspace('ws-a2', '/Users/zcol/Project/BB', '插件A2'),
    ]
    const groups = deriveGroups(listState(ws), ws, [], CONFIG, VIEW, manual)
    expect(groups.find(g => g.label === 'DSH 插件')?.workspaces.map(w => w.workspaceId)).toEqual(['ws-a2', 'ws-a1'])
  })

  it('a renamed rule category renders under the new name', () => {
    const manual: ManualGroups = { categories: [], assignments: {}, renamed: { 'DSH 插件': '插件集' } }
    const groups = deriveGroups(listState(workspaces), workspaces, [], CONFIG, VIEW, manual)
    const byLabel = new Map(groups.map(g => [g.label, g]))
    expect(byLabel.has('插件集')).toBe(true)
    expect(byLabel.get('插件集')?.workspaces.map(w => w.workspaceId)).toEqual(['ws-a'])
    expect(byLabel.has('DSH 插件')).toBe(false)
  })

  it('a hidden rule category is inert — its members become top-level', () => {
    const manual: ManualGroups = { categories: [], assignments: {}, hidden: ['DSH 插件'] }
    const groups = deriveGroups(listState(workspaces), workspaces, [], CONFIG, VIEW, manual)
    expect(groups.find(g => g.label === 'DSH 插件')).toBeUndefined()
    const top = deriveTopLevel(listState(workspaces), workspaces, [], CONFIG, VIEW, manual)
    expect(top.map(w => w.workspaceId)).toEqual(['ws-a', 'ws-c'])
  })
})

describe('category appearance on the tree nodes', () => {
  const ws = [workspace('ws-a', '/Users/zcol/Project/SomePlugin', 'DSH插件Demo', ['s1'])]

  it('deriveGroups carries the appearance entry of each category', () => {
    const manual: ManualGroups = {
      categories: [],
      assignments: {},
      appearance: { 'DSH 插件': { color: 'blue', icon: 'code', pinned: true } },
    }
    const groups = deriveGroups(listState(ws), ws, [], CONFIG, VIEW, manual)
    expect(groups[0]?.appearance).toEqual({ color: 'blue', icon: 'code', pinned: true })
  })

  it('deriveGroups omits appearance when the overlay has none', () => {
    const groups = deriveGroups(listState(ws), ws, [], CONFIG, VIEW, { categories: [], assignments: {} })
    expect(groups[0]?.appearance).toBeUndefined()
  })

  it('deriveSearchGroups carries appearance too', () => {
    const manual: ManualGroups = {
      categories: [],
      assignments: {},
      appearance: { 'DSH 插件': { color: 'red' } },
    }
    const tree = deriveSearchGroups(listState(ws), ws, CONFIG, new Set([session('s1', 'x').id]), [], manual)
    expect(tree.categories[0]?.appearance).toEqual({ color: 'red' })
  })
})

describe('deriveTopLevel', () => {
  const ws = [
    workspace('ws-a', '/Users/zcol/Project/SomePlugin', 'DSH插件Demo'),
    workspace('ws-b', '/Users/zcol/Project/MyDocs', 'MyDocs'),
    workspace('ws-c', '/tmp/random', 'Random'),
  ]

  it('keeps host order for ungrouped workspaces', () => {
    const manual: ManualGroups = { categories: [], assignments: { 'ws-a': null, 'ws-b': '文档' } }
    const top = deriveTopLevel(listState(ws), ws, [], CONFIG, VIEW, manual)
    // ws-a (forced) and ws-c (rule-less), in host order; ws-b grouped.
    expect(top.map(w => w.workspaceId)).toEqual(['ws-a', 'ws-c'])
  })

  it('top-level rows are expanded according to the view', () => {
    const wsC = workspace('ws-c', '/tmp/random', 'Random', ['s1'])
    const view = { expandedCategories: [], expandedWorkspaces: ['ws-c'] }
    const top = deriveTopLevel(listState([wsC]), [wsC], [], CONFIG, view, { categories: [], assignments: {} })
    expect(top[0]?.expanded).toBe(true)
    expect(top[0]?.sessions).toHaveLength(1)
    expect(top[0]?.sessions[0]?.id).toBe('s1')
    // Collapsed view → no sessions.
    const collapsed = deriveTopLevel(listState([wsC]), [wsC], [], CONFIG, VIEW, { categories: [], assignments: {} })
    expect(collapsed[0]?.expanded).toBe(false)
    expect(collapsed[0]?.sessions).toEqual([])
  })

  it('top-level rows honor the manual order (workspaceOrder[__topLevel__])', () => {
    const manual: ManualGroups = {
      categories: [], assignments: { 'ws-a': null, 'ws-b': null, 'ws-c': null },
      workspaceOrder: { __topLevel__: ['ws-c', 'ws-a', 'ws-b'] },
    }
    const top = deriveTopLevel(listState(ws), ws, [], CONFIG, VIEW, manual)
    expect(top.map(w => w.workspaceId)).toEqual(['ws-c', 'ws-a', 'ws-b'])
  })
})

/**
 * A project renders as ONE row: its own directory and every extra folder share
 * that workspace's session list, so a cloud project never reads as a project
 * nested inside itself and its mirror id never surfaces as a folder name.
 */
describe('a project renders as one row', () => {
  const MIRROR = 'C:/Users/zcol/.dsh/remote-workspaces/wmvl31c7ilkuc'
  const LOCAL = 'C:/Users/zcol/云端记忆系统'

  function sessionIn(id: string, cwd: string): SessionSummary {
    return { ...session(id, `会话-${id}`), cwd } as unknown as SessionSummary
  }

  const workspaces = [
    workspace('ws-o', MIRROR, '插件项目', ['s-cloud']),
    workspace('ws-m', LOCAL, '云端记忆系统', ['s-local']),
  ]
  const folders: FoldersDocument = {
    version: 1,
    workspaces: {
      'ws-o': { folders: [], members: [{ path: LOCAL, workspaceId: 'ws-m', kind: 'local' }] },
    },
  }
  const list = {
    ids: ['s-cloud', 's-local'],
    byId: {
      's-cloud': sessionIn('s-cloud', `${MIRROR}/src`),
      's-local': sessionIn('s-local', `${LOCAL}/docs`),
    },
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
  } as unknown as SessionListState
  const noManual: ManualGroups = { categories: [], assignments: {} }
  const view = { expandedCategories: [], expandedWorkspaces: ['ws-o'] }

  it('merges owner and member sessions and emits no folder rows', () => {
    const groups = deriveGroups(list, workspaces, [], CONFIG, view, noManual, new Map(), folders)
    const node = groups.flatMap(group => group.workspaces).find(w => w.workspaceId === 'ws-o')
    expect(node).toBeDefined()
    expect(node!.folders).toBeUndefined()
    expect(node!.sessions.map(s => s.id)).toEqual(['s-cloud', 's-local'])
  })

  it('keeps the pre-folders node shape without extras', () => {
    const groups = deriveGroups(list, workspaces, [], CONFIG, view, noManual, new Map(), {
      version: 1,
      workspaces: {},
    })
    const node = groups.flatMap(group => group.workspaces).find(w => w.workspaceId === 'ws-o')
    expect(node?.folders).toBeUndefined()
    expect(node?.sessions.map(s => s.id)).toEqual(['s-cloud'])
  })
})

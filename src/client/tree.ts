/**
 * Derives the three-level workspace-groups tree: 分类文件夹 → 项目文件夹 →
 * 会话行. Pure derivation — all inputs are snapshots; the renderer never
 * scans. Session visibility rules mirror the official ui-workspace tree
 * (blank rows only when current, archived excluded, subagent rows excluded).
 */
import type {
  SessionListState,
  SessionSearchResultItem,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: the unified UI status snapshot. 0.1.6 把 running / pendingInteraction /
// 未读完成提示收敛为 ui-session 的 SessionStatusSnapshot；SessionSummary.completed
// 与 SessionListState.current 同时移除，当前会话改由 `mainView` 保留位推导。
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { indexSubagentDescendants, type SubagentDescendantSummary } from './subagent-lineage.ts'
import { effectiveCategories, orderedWorkspaceIds, resolveCategory } from '../core/matcher.ts'
import { TOP_LEVEL_ORDER_KEY, UNCATEGORIZED_LABEL, type GroupsConfig, type ManualGroups } from '../core/types.ts'

/** Pending interaction kinds with dedicated Workspace-row presentation. */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** Current unified UI status by Session (ui-session snapshot). */
type SessionStatuses = SessionStatusSnapshot

/**
 * The Session the Conversation is currently showing.
 *
 * 0.1.6 removed `SessionListState.current`: selection is expressed as the
 * Session retained through the `mainView` reference source (the ui-workspace
 * navigation holds exactly one). Same read the official browser performs.
 * @param list - sessions list snapshot.
 * @returns the retained Session id, or undefined while no Session is selected.
 */
export function currentSessionId(list: SessionListState): SessionId | undefined {
  return Object.values(list.byId).find(session => (session.retainedBy?.mainView ?? 0) > 0)?.id
}

/** Keep navigation presentation independent from domain-owned interaction objects. */
function visiblePendingKind(kind: string | undefined): SessionPendingInteractionStatus | undefined {
  switch (kind) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return kind
    default:
      return undefined
  }
}

/** One top-level session row inside a workspace folder. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; blank rows show the localized New Session label. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  pendingInteraction?: SessionPendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  updatedAt: number
  /** Search-hit marker (rendered with a highlighted tint in search mode). */
  matched?: boolean
  /** Content-match snippet from the Host search (search mode only). */
  snippet?: string
}

/** One workspace folder row inside a category folder. */
export interface WorkspaceGroupNode {
  workspaceId: WorkspaceId
  /** Canonical host directory path. */
  path: string
  /** Display title. */
  label: string
  /** Workspace creation time (epoch ms). */
  createdAt: number
  /** Total visible sessions in the folder. */
  sessionCount: number
  expanded: boolean
  /** The folder contains the selected session (active folder tint). */
  containsCurrent: boolean
  /** Visible session rows (empty while the folder is folded). */
  sessions: readonly SessionNode[]
}

/** One category folder at the top of the tree. */
export interface CategoryNode {
  /** Stable category key: the configured label, or the uncategorized bucket. */
  key: string
  /** Display label. */
  label: string
  expanded: boolean
  /** The category contains the selected session (active folder tint). */
  containsCurrent: boolean
  /** Workspace folders in host order. */
  workspaces: readonly WorkspaceGroupNode[]
}

/** Viewing state consumed by the derivation. */
export interface GroupsTreeView {
  expandedCategories: readonly string[]
  expandedWorkspaces: readonly string[]
}

/** Key of the uncategorized bucket (matches the config fallback label). */
export const UNCATEGORIZED_KEY = UNCATEGORIZED_LABEL

/** Directory display label: basename of the path (both separators accepted). */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return UNCATEGORIZED_LABEL
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base !== undefined && base !== '' ? base : cwd
}

/** Ordinary sessions are visible; blank only when current; archived/subagent never. */
function sessionVisible(session: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return session.origin !== 'subagent'
    && !archived.has(session.id)
    && (!session.blank || session.id === current)
}

/** Blank rows display the localized New Session label (never enters search). */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? 'New Session' : session.displayTitle
}

function sessionNode(
  s: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
  statuses: SessionStatuses,
): SessionNode {
  // `SessionStatusSnapshot` is typed as ReadonlyMap, but the framework binds a
  // plain record at runtime (client.js: `statuses[sessionId]`). Read both shapes
  // so a hook backed by an object never throws "statuses.get is not a function".
  const status = typeof (statuses as { get?: unknown } | undefined)?.get === 'function'
    ? statuses.get(s.id)
    : (statuses as unknown as Record<string, SessionStatus | undefined>)[s.id]
  const pending = visiblePendingKind(status?.pendingInteraction?.kind)
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: status?.running ?? s.running,
    runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
    completed: status?.completionUnread === true,
    updatedAt: s.updatedAt,
    ...(pending === undefined ? {} : { pendingInteraction: pending }),
  }
}

/** Visible sessions of one workspace in its stored account order. */
function workspaceSessions(
  list: SessionListState,
  workspace: WorkspaceView,
  archived: ReadonlySet<SessionId>,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
  statuses: SessionStatuses,
  current: SessionId | undefined,
): SessionNode[] {
  const nodes: SessionNode[] = []
  for (const id of workspace.sessionIds) {
    const summary = list.byId[id]
    if (summary === undefined) continue // account may lead the list pull; appears when the summary lands
    if (!sessionVisible(summary, current, archived)) continue
    nodes.push(sessionNode(summary, descendants, statuses))
  }
  return nodes
}

/**
 * Derive the three-level tree.
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param config - sidecar grouping config (rule categories).
 * @param view - local expansion arrays.
 * @param manual - runtime overlay (manual groups + overrides). A workspace's
 * manual override wins over rule classification; removing it reverts to rules.
 * @param statuses - unified UI status by Session (drives the running / warning
 * / unread-completion row indicators); defaults to none (tests).
 * @returns category sections in render order (rule categories first, then
 * manual-only ones, uncategorized last). Manual groups render even while
 * empty; empty rule buckets stay hidden.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  config: GroupsConfig,
  view: GroupsTreeView,
  manual: ManualGroups,
  statuses: SessionStatuses = new Map(),
): CategoryNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedCategories = new Set(view.expandedCategories)
  const expandedWorkspaces = new Set(view.expandedWorkspaces)
  const descendants = indexSubagentDescendants(list.byId)
  const current = currentSessionId(list)

  // Bucket workspaces by display key. Seed with every effective category so
  // manual groups render while empty. Top-level (ungrouped) workspaces are
  // handled by deriveTopLevel and never land here.
  const byCategory = new Map<string, WorkspaceView[]>()
  for (const { key } of effectiveCategories(config, manual)) {
    byCategory.set(key, [])
  }
  for (const workspace of workspaces) {
    const key = resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title)
    if (key === undefined) continue // top-level — rendered by deriveTopLevel
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key)!.push(workspace)
  }

  const manualCategories = new Set(manual.categories)
  const currentWorkspaceId = current === undefined
    ? undefined
    : workspaces.find(w => w.sessionIds.includes(current))?.workspaceId

  const nodes: CategoryNode[] = []
  // Effective categories in display order (categoryOrder applied).
  for (const key of effectiveCategories(config, manual).map(e => e.key)) {
    const bucket = byCategory.get(key) ?? []
    // Manual groups stay visible while empty; everything else hides when empty.
    if (bucket.length === 0 && !manualCategories.has(key)) continue
    const expanded = expandedCategories.has(key)
    const ordered = orderedWorkspaceIds(manual, key, bucket.map(w => w.workspaceId as string))
    const workspaceNodes: WorkspaceGroupNode[] = []
    let containsCurrent = false
    for (const workspaceId of ordered) {
      const workspace = bucket.find(w => w.workspaceId === workspaceId)
      if (workspace === undefined) continue
      const sessions = workspaceSessions(list, workspace, archived, descendants, statuses, current)
      const wsExpanded = expandedWorkspaces.has(workspace.workspaceId as string)
      const wsContainsCurrent = workspace.workspaceId === currentWorkspaceId
      if (wsContainsCurrent) containsCurrent = true
      workspaceNodes.push({
        workspaceId: workspace.workspaceId,
        path: workspace.path,
        label: workspace.title,
        createdAt: Date.parse(workspace.createdAt),
        sessionCount: sessions.length,
        expanded: wsExpanded,
        containsCurrent: wsContainsCurrent,
        sessions: wsExpanded ? sessions : [],
      })
    }
    nodes.push({
      key,
      label: key,
      expanded,
      containsCurrent,
      workspaces: workspaceNodes,
    })
  }
  return nodes
}

/**
 * Top-level (ungrouped) workspace rows: workspaces resolving to no category
 * (no manual override and no matching rule, or a forced `null` override).
 * Rendered after the group folders as plain project rows (not inside any
 * folder), in manual top-level order (`workspaceOrder[TOP_LEVEL_ORDER_KEY]`),
 * falling back to host registration order.
 */
export function deriveTopLevel(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  config: GroupsConfig,
  view: GroupsTreeView,
  manual: ManualGroups,
  statuses: SessionStatuses = new Map(),
): WorkspaceGroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedWorkspaces = new Set(view.expandedWorkspaces)
  const descendants = indexSubagentDescendants(list.byId)
  const current = currentSessionId(list)
  const currentWorkspaceId = current === undefined
    ? undefined
    : workspaces.find(w => w.sessionIds.includes(current))?.workspaceId

  const topLevelIds = workspaces
    .filter(w => resolveCategory(config, manual, w.workspaceId, w.path, w.title) === undefined)
    .map(w => w.workspaceId as string)
  const ordered = orderedWorkspaceIds(manual, TOP_LEVEL_ORDER_KEY, topLevelIds)

  const nodes: WorkspaceGroupNode[] = []
  for (const workspaceId of ordered) {
    const workspace = workspaces.find(w => w.workspaceId === workspaceId)
    if (workspace === undefined) continue
    const sessions = workspaceSessions(list, workspace, archived, descendants, statuses, current)
    const wsExpanded = expandedWorkspaces.has(workspaceId)
    nodes.push({
      workspaceId: workspace.workspaceId,
      path: workspace.path,
      label: workspace.title,
      createdAt: Date.parse(workspace.createdAt),
      sessionCount: sessions.length,
      expanded: wsExpanded,
      containsCurrent: workspace.workspaceId === currentWorkspaceId,
      sessions: wsExpanded ? sessions : [],
    })
  }
  return nodes
}

/** Recency comparator: newest first, id as the deterministic tiebreak. */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/** Bounded set of matched sessions plus content snippets (feeds the search tree). */
export interface SearchMatchSet {
  /** Session ids that matched (local metadata hits + Host content hits). */
  matchedIds: ReadonlySet<SessionId>
  /** Content-match snippets keyed by session id (Host search only). */
  snippetsBySession: ReadonlyMap<SessionId, string>
  hasMore: boolean
}

/**
 * Compute the matched-session set: immediate title/Workspace substring matches
 * from the local list, merged with ranked Host content matches. The consumer
 * (SearchBody) derives the pruned three-level tree from these ids.
 */
export function deriveSearchMatches(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  config: GroupsConfig,
  query: string,
  archivedSessionIds: readonly SessionId[],
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
): SearchMatchSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { matchedIds: new Set(), snippetsBySession: new Map(), hasMore: false }
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const current = currentSessionId(list)

  const workspaceBySession = new Map<SessionId, WorkspaceView>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace)
    }
  }
  const labelOf = (summary: SessionSummary): string =>
    workspaceBySession.get(summary.id)?.title ?? workspaceLabel(summary.cwd)

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined || summary.blank || !sessionVisible(summary, current, archived)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  local.sort(byRecency)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, current, archived)) include(summary)
  }

  const snippets = new Map<SessionId, string>()
  for (const item of content.items) {
    if (item.snippet !== undefined) snippets.set(item.sessionId, item.snippet)
  }

  return {
    matchedIds: ordered.slice(0, limit).reduce((set, summary) => { set.add(summary.id); return set }, new Set<SessionId>()),
    snippetsBySession: snippets,
    hasMore: content.hasMore || ordered.length > limit,
  }
}

/** Search tree: group folders plus top-level (ungrouped) matched workspaces. */
export interface SearchTree {
  /** Group folders containing matched sessions, in display order. */
  categories: CategoryNode[]
  /** Top-level (ungrouped) workspaces holding matched sessions. */
  topLevel: WorkspaceGroupNode[]
}

/**
 * Build a three-level search tree containing ONLY the branches that hold a
 * matched session: 分类文件夹 → 项目文件夹 → 命中会话行. Every matched
 * session carries `matched: true` so rows render with the search-hit tint.
 * Classification uses the same precedence as the idle tree (manual override →
 * rules), so search shows the same grouping the user sees. Matched top-level
 * workspaces are returned separately (rendered as plain rows).
 *
 * @param list - sessions list snapshot.
 * @param workspaces - real workspaces in stable Host order.
 * @param config - sidecar grouping config.
 * @param matchedIds - set of session ids that matched the query.
 * @param archivedSessionIds - registry-global archive set.
 * @param manual - runtime overlay (manual groups + overrides).
 * @param snippetsBySession - optional content-match snippets keyed by session id.
 * @param statuses - unified UI status by Session (drives the running / warning
 * / unread-completion row indicators); defaults to none (tests).
 * @returns group folders in render order plus top-level matched workspaces,
 * pruned to matched branches only.
 */
export function deriveSearchGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  config: GroupsConfig,
  matchedIds: ReadonlySet<SessionId>,
  archivedSessionIds: readonly SessionId[],
  manual: ManualGroups,
  snippetsBySession?: ReadonlyMap<SessionId, string>,
  statuses: SessionStatuses = new Map(),
): SearchTree {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const current = currentSessionId(list)

  const byCategory = new Map<string, WorkspaceGroupNode[]>()
  for (const key of effectiveCategories(config, manual).map(e => e.key)) byCategory.set(key, [])

  const topLevel: WorkspaceGroupNode[] = []
  for (const workspace of workspaces) {
    // Only sessions that matched the query and are visible in this folder.
    const nodes: SessionNode[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined || !matchedIds.has(id)) continue
      if (!sessionVisible(summary, current, archived)) continue
      const node = sessionNode(summary, descendants, statuses)
      const snippet = snippetsBySession?.get(id)
      nodes.push({
        ...node,
        matched: true,
        ...(snippet === undefined ? {} : { snippet }),
      })
    }
    if (nodes.length === 0) continue

    const node: WorkspaceGroupNode = {
      workspaceId: workspace.workspaceId,
      path: workspace.path,
      label: workspace.title,
      createdAt: Date.parse(workspace.createdAt),
      sessionCount: nodes.length,
      expanded: true,
      containsCurrent: false,
      sessions: nodes,
    }
    const key = resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title)
    if (key === undefined) {
      topLevel.push(node)
      continue
    }
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key)!.push(node)
  }

  const categories: CategoryNode[] = []
  // Same display order as the idle tree.
  for (const key of effectiveCategories(config, manual).map(e => e.key)) {
    const workspaceNodes = byCategory.get(key)
    if (workspaceNodes === undefined || workspaceNodes.length === 0) continue
    categories.push({
      key,
      label: key,
      expanded: true,
      containsCurrent: false,
      workspaces: workspaceNodes,
    })
  }
  return { categories, topLevel }
}

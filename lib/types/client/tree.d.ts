/**
 * Derives the three-level workspace-groups tree: 分类文件夹 → 项目文件夹 →
 * 会话行. Pure derivation — all inputs are snapshots; the renderer never
 * scans. Session visibility rules mirror the official ui-workspace tree
 * (blank rows only when current, archived excluded, subagent rows excluded).
 */
import type { SessionListState, SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client';
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { type GroupsConfig, type ManualGroups } from '../core/types.ts';
/** Pending interaction kinds with dedicated Workspace-row presentation. */
export type SessionPendingInteractionStatus = 'approval' | 'plan-review' | 'question';
/** Current unified UI status by Session (ui-session snapshot). */
type SessionStatuses = SessionStatusSnapshot;
/**
 * The Session the Conversation is currently showing.
 *
 * 0.1.6 removed `SessionListState.current`: selection is expressed as the
 * Session retained through the `mainView` reference source (the ui-workspace
 * navigation holds exactly one). Same read the official browser performs.
 * @param list - sessions list snapshot.
 * @returns the retained Session id, or undefined while no Session is selected.
 */
export declare function currentSessionId(list: SessionListState): SessionId | undefined;
/** One top-level session row inside a workspace folder. */
export interface SessionNode {
    id: SessionId;
    /** Stored display title; blank rows show the localized New Session label. */
    title: string;
    /** The provisional blank session (renderer shows the localized New Session title). */
    blank: boolean;
    pendingInteraction?: SessionPendingInteractionStatus;
    running: boolean;
    /** Running descendants connected through uninterrupted subagent-origin lineage. */
    runningSubagentCount: number;
    /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
    completed: boolean;
    updatedAt: number;
    /** Search-hit marker (rendered with a highlighted tint in search mode). */
    matched?: boolean;
    /** Content-match snippet from the Host search (search mode only). */
    snippet?: string;
}
/** One workspace folder row inside a category folder. */
export interface WorkspaceGroupNode {
    workspaceId: WorkspaceId;
    /** Canonical host directory path. */
    path: string;
    /** Display title. */
    label: string;
    /** Workspace creation time (epoch ms). */
    createdAt: number;
    /** Total visible sessions in the folder. */
    sessionCount: number;
    expanded: boolean;
    /** The folder contains the selected session (active folder tint). */
    containsCurrent: boolean;
    /** Visible session rows (empty while the folder is folded). */
    sessions: readonly SessionNode[];
}
/** One category folder at the top of the tree. */
export interface CategoryNode {
    /** Stable category key: the configured label, or the uncategorized bucket. */
    key: string;
    /** Display label. */
    label: string;
    expanded: boolean;
    /** The category contains the selected session (active folder tint). */
    containsCurrent: boolean;
    /** Workspace folders in host order. */
    workspaces: readonly WorkspaceGroupNode[];
}
/** Viewing state consumed by the derivation. */
export interface GroupsTreeView {
    expandedCategories: readonly string[];
    expandedWorkspaces: readonly string[];
}
/** Key of the uncategorized bucket (matches the config fallback label). */
export declare const UNCATEGORIZED_KEY = "\u672A\u5206\u7C7B";
/** Directory display label: basename of the path (both separators accepted). */
export declare function workspaceLabel(cwd: string | undefined): string;
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
export declare function deriveGroups(list: SessionListState, workspaces: readonly WorkspaceView[], archivedSessionIds: readonly SessionId[], config: GroupsConfig, view: GroupsTreeView, manual: ManualGroups, statuses?: SessionStatuses): CategoryNode[];
/**
 * Top-level (ungrouped) workspace rows: workspaces resolving to no category
 * (no manual override and no matching rule, or a forced `null` override).
 * Rendered after the group folders as plain project rows (not inside any
 * folder), in manual top-level order (`workspaceOrder[TOP_LEVEL_ORDER_KEY]`),
 * falling back to host registration order.
 */
export declare function deriveTopLevel(list: SessionListState, workspaces: readonly WorkspaceView[], archivedSessionIds: readonly SessionId[], config: GroupsConfig, view: GroupsTreeView, manual: ManualGroups, statuses?: SessionStatuses): WorkspaceGroupNode[];
/** Bounded set of matched sessions plus content snippets (feeds the search tree). */
export interface SearchMatchSet {
    /** Session ids that matched (local metadata hits + Host content hits). */
    matchedIds: ReadonlySet<SessionId>;
    /** Content-match snippets keyed by session id (Host search only). */
    snippetsBySession: ReadonlyMap<SessionId, string>;
    hasMore: boolean;
}
/**
 * Compute the matched-session set: immediate title/Workspace substring matches
 * from the local list, merged with ranked Host content matches. The consumer
 * (SearchBody) derives the pruned three-level tree from these ids.
 */
export declare function deriveSearchMatches(list: SessionListState, workspaces: readonly WorkspaceView[], config: GroupsConfig, query: string, archivedSessionIds: readonly SessionId[], content: {
    items: readonly SessionSearchResultItem[];
    hasMore: boolean;
}, limit: number): SearchMatchSet;
/** Search tree: group folders plus top-level (ungrouped) matched workspaces. */
export interface SearchTree {
    /** Group folders containing matched sessions, in display order. */
    categories: CategoryNode[];
    /** Top-level (ungrouped) workspaces holding matched sessions. */
    topLevel: WorkspaceGroupNode[];
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
export declare function deriveSearchGroups(list: SessionListState, workspaces: readonly WorkspaceView[], config: GroupsConfig, matchedIds: ReadonlySet<SessionId>, archivedSessionIds: readonly SessionId[], manual: ManualGroups, snippetsBySession?: ReadonlyMap<SessionId, string>, statuses?: SessionStatuses): SearchTree;
export {};

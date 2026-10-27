/**
 * Row components for the workspace-groups tree. Kept dependency-light: they
 * consume only React, primitives (StateDot/Menu/icons), and the shared CSS
 * string. Each row owns its hover actions menu; dialogs live in the browser
 * root so they survive row unmounts during collapse.
 *
 * Drag & drop: workspace rows are draggable sources; category rows (and
 * workspace rows, standing for their containing category) are drop targets.
 * The payload is a custom dataTransfer type so only in-plugin drags land.
 */
import { useState, type DragEvent, type ReactNode } from 'react'
import {
  IconArchiveOutlineRegular,
  IconBranchOutlineRegular,
  IconEditOutlineRegular,
  IconEllipsisOutlineRegular,
  IconFolderCloseMedium,
  IconFolderOpenMedium,
  IconFolderOpenOutlineRegular,
  IconPlusOutlineRegular,
  IconProjectAddOutlineRegular,
  IconRightUpOutlineRegular,
  IconTriangleRightFillMedium,
  IconTrashOutlineRegular,
  Menu,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGroupsKey } from './locales.ts'
import type { CategoryNode, SessionNode, WorkspaceGroupNode } from './tree.ts'

type T = TranslateNS<'workspaceGroups'>

/** dataTransfer type carrying the dragged workspace id (in-plugin drags only). */
export const DND_WORKSPACE_TYPE = 'application/x-dsh-workspace-groups'
/** dataTransfer type carrying the dragged category key (group reorder). */
export const DND_CATEGORY_TYPE = 'application/x-dsh-workspace-groups-category'

/** Whether a drag carries any of the plugin's payloads (drop targets accept both). */
export function hasPluginDragType(types: DOMStringList | readonly string[]): boolean {
  const list = Array.from(types as Iterable<string>)
  return list.includes(DND_WORKSPACE_TYPE) || list.includes(DND_CATEGORY_TYPE)
}

/** Pending interaction status → primitives StateDot state. */
function pendingState(status: SessionNode['pendingInteraction']): StateDotState | undefined {
  switch (status) {
    case 'approval':
    case 'plan-review':
    case 'question':
      return 'warning'
    default:
      return undefined
  }
}

/** Primary status dot state for a session row. */
export function sessionDotState(node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed'>): StateDotState {
  if (pendingState(node.pendingInteraction) !== undefined) return 'warning'
  if (node.running || node.runningSubagentCount > 0) return 'ongoing'
  return node.completed ? 'done' : 'done'
}

/** Compact relative time ("now"/"5min"/"3h"/"2d"/"4mo"/"1y"). */
export function relativeTimeLabel(updatedAt: number, now: number): string {
  const diff = Math.max(0, now - updatedAt)
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  if (diff < MIN) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MIN)}min`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d`
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}mo`
  return `${Math.floor(diff / (365 * DAY))}y`
}

/** Drop-target props shared by category and workspace rows (all optional). */
export interface RowDropProps {
  /** Row is under the dragged workspace — show the drop highlight. */
  dropActive?: boolean
  /** Insertion indicator: a line above (before) or below (after) this row. */
  insertLine?: 'before' | 'after'
  /** Accept a drag over this row (must preventDefault to allow the drop). */
  onRowDragOver?: (event: DragEvent) => void
  /** Clear the highlight when the pointer leaves the row. */
  onRowDragLeave?: (event: DragEvent) => void
  /** Drop a workspace onto this row. */
  onRowDrop?: (event: DragEvent) => void
}

/**
 * One category folder row: toggle, rename/delete menu (every group — rule
 * groups via overlay renames/hides), draggable source for group reorder and
 * drop target for both workspace moves and group reorders.
 */
export function CategoryRow({ node, t, onToggle, onRename, onDelete, dropActive = false, insertLine, onRowDragOver, onRowDragLeave, onRowDrop, onDragStartCategory }: {
  node: CategoryNode
  t: T
  onToggle: () => void
  /** Rename/delete actions; the hover menu renders only when both provided. */
  onRename?: () => void
  onDelete?: () => void
  /** Group reorder source; the row becomes draggable only when provided. */
  onDragStartCategory?: (event: DragEvent) => void
} & RowDropProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const count = node.workspaces.length
  const manageable = onRename !== undefined && onDelete !== undefined
  return (
    <div
      className={`wgCategoryRow${dropActive ? ' wgDropTarget' : ''}${insertLine === 'before' ? ' wgInsertBefore' : insertLine === 'after' ? ' wgInsertAfter' : ''}`}
      role="treeitem"
      aria-expanded={node.expanded}
      aria-label={t('section.workspaces')}
      data-wg-category={node.key}
      /* Flower-branch hooks: a category row starts a group, so the stem kinks
         here. Deliberately NOT marked active even when it contains the open
         session — the session row below it carries that marker, and only one
         row may claim it (see BRANCH_ACTIVE_ATTRIBUTE). */
      data-wg-branch-row=""
      data-wg-branch-group=""
      draggable={onDragStartCategory !== undefined}
      onClick={onToggle}
      onDragStart={onDragStartCategory}
      onDragOver={onRowDragOver}
      onDragLeave={onRowDragLeave}
      onDrop={onRowDrop}
    >
      <span className={`wgChevron${node.expanded ? ' wgChevronOpen' : ''}`}>
        <IconTriangleRightFillMedium />
      </span>
      <span className="wgCategoryIcon" data-wg-row-icon="group">
        {node.expanded ? <IconFolderOpenMedium /> : <IconFolderCloseMedium />}
      </span>
      <span className="wgCategoryLabel">{node.label}</span>
      <span className="wgCategoryCount">{count}</span>
      {manageable && (
        <span className="wgRowActions">
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={[
              { id: 'rename', label: t('group.rename'), icon: <IconEditOutlineRegular /> },
              { id: 'delete', label: t('group.delete'), icon: <IconTrashOutlineRegular />, danger: true },
            ]}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') onRename()
              if (id === 'delete') onDelete()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className="wgIconButton"
                draggable={false}
                aria-label={`${t('group.rename')} ${node.label}`}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutlineRegular />
              </button>
            )}
          />
        </span>
      )}
    </div>
  )
}

/** One workspace folder row inside a category: draggable source + drop target. */
export function WorkspaceRow({ node, t, onToggle, onNewSession, onRename, onDelete, canMoveOut = false, onMoveOut, onOpenInFolder, flat = false, dropActive = false, insertLine, onRowDragOver, onRowDragLeave, onRowDrop, onDragStartExtra }: {
  node: WorkspaceGroupNode
  t: T
  onToggle: () => void
  onNewSession: () => void
  onRename: () => void
  onDelete: () => void
  /** Project currently sits inside a group — offer "move out of group". */
  canMoveOut?: boolean
  onMoveOut?: () => void
  /**
   * Open the project directory in the host's file manager. Omitted when the
   * host resolved no folder application (no capability, or a remote launch),
   * which keeps the entry out of the menu entirely.
   */
  onOpenInFolder?: () => void
  /** Render as a top-level row (no folder indentation). */
  flat?: boolean
  /** Extra dragstart hook (e.g. collapse all expanded projects while dragging). */
  onDragStartExtra?: () => void
} & RowDropProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuItems = [
    ...(onOpenInFolder !== undefined
      ? [{ id: 'openInFolder', label: t('workspace.openInFolder'), icon: <IconFolderOpenOutlineRegular size={16} /> }]
      : []),
    ...(canMoveOut && onMoveOut !== undefined
      ? [{ id: 'moveOut', label: t('workspace.moveOutOfGroup'), icon: <IconRightUpOutlineRegular size={16} /> }]
      : []),
    { id: 'rename', label: t('workspace.rename'), icon: <IconEditOutlineRegular /> },
    { id: 'delete', label: t('workspace.delete'), icon: <IconTrashOutlineRegular />, danger: true },
  ]
  const onDragStart = (event: DragEvent): void => {
    event.dataTransfer.setData(DND_WORKSPACE_TYPE, node.workspaceId)
    event.dataTransfer.effectAllowed = 'move'
    onDragStartExtra?.()
  }
  return (
    <div
      className={`wgProjectRow${node.containsCurrent ? ' wgProjectActive' : ''}${flat ? ' wgProjectFlat' : ''}${dropActive ? ' wgDropTarget' : ''}${insertLine === 'before' ? ' wgInsertBefore' : insertLine === 'after' ? ' wgInsertAfter' : ''}`}
      role="treeitem"
      aria-expanded={node.expanded}
      data-wsid={node.workspaceId}
      /* Branch hooks. A project row IS a branch point: it heads its own run of
         session rows, so the stem kinks here and curves back in on the first
         session beneath it. That gives the branch one kink per project, which is
         the readable rhythm — a single top-level category would otherwise never
         produce a kink at all.
         Active is NOT set here: when this project holds the open session, the
         session row itself carries the marker. */
      data-wg-branch-row=""
      data-wg-branch-group=""
      draggable
      onClick={onToggle}
      onDragStart={onDragStart}
      onDragOver={onRowDragOver}
      onDragLeave={onRowDragLeave}
      onDrop={onRowDrop}
    >
      <span className={`wgChevron${node.expanded ? ' wgChevronOpen' : ''}`}>
        <IconTriangleRightFillMedium />
      </span>
      <span className="wgCategoryIcon" data-wg-row-icon="project">
        {/* Project rows use the project glyph (same as the official workspace
            browser) so groups (folder glyph) and projects stay distinguishable. */}
        <IconProjectAddOutlineRegular />
      </span>
      <span className="wgProjectLabel" title={node.path}>{node.label}</span>
      <span className="wgRowActions">
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          onSelect={(id) => {
            setMenuOpen(false)
            if (id === 'openInFolder') onOpenInFolder?.()
            if (id === 'moveOut') onMoveOut?.()
            if (id === 'rename') onRename()
            if (id === 'delete') onDelete()
          }}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className="wgIconButton"
              draggable={false}
              aria-label={`${t('workspace.rename')} ${node.label}`}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
            >
              <IconEllipsisOutlineRegular />
            </button>
          )}
        />
        <button
          type="button"
          className="wgIconButton"
          draggable={false}
          aria-label={`${t('session.new')} ${node.label}`}
          onClick={(e) => { e.stopPropagation(); onNewSession() }}
        >
          <IconPlusOutlineRegular />
        </button>
      </span>
    </div>
  )
}

/**
 * Children container for one folder's rows.
 *
 * Keeps the tree's `role="group"` semantics and gives the rows a single
 * positioned ancestor. It used to draw a per-folder guide rail; that is now the
 * flower branch's job (one continuous stem for the whole tree, see
 * `FlowerBranch.tsx`), so this is structure only.
 */
export function TreeChildren({ children }: { children: ReactNode }) {
  return (
    <div className="wgTreeChildren" role="group">
      {children}
    </div>
  )
}

/** One session leaf row. */
export function SessionRow({ node, currentId, now, t, onOpen, onRename, onFork, onArchive }: {
  node: SessionNode
  currentId: string | undefined
  now: number
  t: T
  onOpen: (id: SessionNode['id']) => void
  onRename: (id: SessionNode['id'], currentTitle: string) => void
  onFork: (id: SessionNode['id']) => void
  onArchive: (id: SessionNode['id']) => void
}) {
  const selected = node.id === currentId
  const [menuOpen, setMenuOpen] = useState(false)
  // The ACTIVE session hands its status slot to the flower: the branch anchors
  // on this cell (`anchorX` targets `.wgStatusSlot`), so the bloom and the dot
  // occupy the same 14px square. Drawing both puts the dot's green "ongoing"
  // ring (or the loading spinner) on top of the petals, which is what made the
  // flower look broken. The flower already carries this row's state — it turns
  // exactly while the session runs — so the dot is redundant here anyway.
  const showStatus = !selected
  const menuItems = [
    { id: 'rename', label: t('session.rename'), icon: <IconEditOutlineRegular /> },
    { id: 'fork', label: t('session.fork'), icon: <IconBranchOutlineRegular /> },
    { id: 'archive', label: t('session.archive'), icon: <IconArchiveOutlineRegular size={16} /> },
  ]
  return (
    <div
      className={`wgSessionRow${selected ? ' wgSelected' : ''}${node.matched === true ? ' wgMatched' : ''}`}
      role="treeitem"
      aria-selected={selected}
      data-wg-branch-row=""
      {...(selected ? { 'data-wg-branch-active': '' } : {})}
      onClick={() => { onOpen(node.id) }}
    >
      <span className="wgStatusSlot">
        {showStatus && <StateDot state={sessionDotState(node)} />}
      </span>
      <span className="wgSessionTitle">{node.title}</span>
      {!node.blank && <span className="wgSessionTime">{relativeTimeLabel(node.updatedAt, now)}</span>}
      {node.snippet !== undefined && (
        <span className="wgSessionSnippet" title={node.snippet}>{node.snippet}</span>
      )}
      {!node.blank && (
        <span className="wgRowActions">
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={menuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') onRename(node.id, node.title)
              if (id === 'fork') onFork(node.id)
              if (id === 'archive') onArchive(node.id)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className="wgIconButton"
                aria-label={`${t('session.rename')} ${node.title}`}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutlineRegular />
              </button>
            )}
          />
        </span>
      )}
    </div>
  )
}

export type { T }

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
import { type DragEvent, type ReactNode } from 'react';
import { type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { CategoryNode, SessionNode, WorkspaceGroupNode } from './tree.ts';
type T = TranslateNS<'workspaceGroups'>;
/** dataTransfer type carrying the dragged workspace id (in-plugin drags only). */
export declare const DND_WORKSPACE_TYPE = "application/x-dsh-workspace-groups";
/** dataTransfer type carrying the dragged category key (group reorder). */
export declare const DND_CATEGORY_TYPE = "application/x-dsh-workspace-groups-category";
/** Whether a drag carries any of the plugin's payloads (drop targets accept both). */
export declare function hasPluginDragType(types: DOMStringList | readonly string[]): boolean;
/** Primary status dot state for a session row. */
export declare function sessionDotState(node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed'>): StateDotState;
/** Compact relative time ("now"/"5min"/"3h"/"2d"/"4mo"/"1y"). */
export declare function relativeTimeLabel(updatedAt: number, now: number): string;
/** Drop-target props shared by category and workspace rows (all optional). */
export interface RowDropProps {
    /** Row is under the dragged workspace — show the drop highlight. */
    dropActive?: boolean;
    /** Insertion indicator: a line above (before) or below (after) this row. */
    insertLine?: 'before' | 'after';
    /** Accept a drag over this row (must preventDefault to allow the drop). */
    onRowDragOver?: (event: DragEvent) => void;
    /** Clear the highlight when the pointer leaves the row. */
    onRowDragLeave?: (event: DragEvent) => void;
    /** Drop a workspace onto this row. */
    onRowDrop?: (event: DragEvent) => void;
}
/**
 * One category folder row: toggle, rename/delete menu (every group — rule
 * groups via overlay renames/hides), draggable source for group reorder and
 * drop target for both workspace moves and group reorders.
 */
export declare function CategoryRow({ node, t, onToggle, onRename, onDelete, dropActive, insertLine, onRowDragOver, onRowDragLeave, onRowDrop, onDragStartCategory }: {
    node: CategoryNode;
    t: T;
    onToggle: () => void;
    /** Rename/delete actions; the hover menu renders only when both provided. */
    onRename?: () => void;
    onDelete?: () => void;
    /** Group reorder source; the row becomes draggable only when provided. */
    onDragStartCategory?: (event: DragEvent) => void;
} & RowDropProps): import("react").JSX.Element;
/** One workspace folder row inside a category: draggable source + drop target. */
export declare function WorkspaceRow({ node, t, onToggle, onNewSession, onRename, onDelete, canMoveOut, onMoveOut, onOpenInFolder, flat, dropActive, insertLine, onRowDragOver, onRowDragLeave, onRowDrop, onDragStartExtra }: {
    node: WorkspaceGroupNode;
    t: T;
    onToggle: () => void;
    onNewSession: () => void;
    onRename: () => void;
    onDelete: () => void;
    /** Project currently sits inside a group — offer "move out of group". */
    canMoveOut?: boolean;
    onMoveOut?: () => void;
    /**
     * Open the project directory in the host's file manager. Omitted when the
     * host resolved no folder application (no capability, or a remote launch),
     * which keeps the entry out of the menu entirely.
     */
    onOpenInFolder?: () => void;
    /** Render as a top-level row (no folder indentation). */
    flat?: boolean;
    /** Extra dragstart hook (e.g. collapse all expanded projects while dragging). */
    onDragStartExtra?: () => void;
} & RowDropProps): import("react").JSX.Element;
/**
 * Children container for one folder's rows.
 *
 * Keeps the tree's `role="group"` semantics and gives the rows a single
 * positioned ancestor. It used to draw a per-folder guide rail; that is now the
 * flower branch's job (one continuous stem for the whole tree, see
 * `FlowerBranch.tsx`), so this is structure only.
 */
export declare function TreeChildren({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/** One session leaf row. */
export declare function SessionRow({ node, currentId, now, t, onOpen, onRename, onFork, onArchive }: {
    node: SessionNode;
    currentId: string | undefined;
    now: number;
    t: T;
    onOpen: (id: SessionNode['id']) => void;
    onRename: (id: SessionNode['id'], currentTitle: string) => void;
    onFork: (id: SessionNode['id']) => void;
    onArchive: (id: SessionNode['id']) => void;
}): import("react").JSX.Element;
export type { T };

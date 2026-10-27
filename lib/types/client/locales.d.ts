/**
 * Locale dictionaries for the workspace-groups browser. The namespace is
 * `workspaceGroups` (independent from ui-workspace's `workspace` namespace).
 */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots';
/** Dictionary keys of the workspaceGroups namespace (single source of truth). */
export type WorkspaceGroupsKey = 'section.workspaces' | 'section.sessions' | 'search' | 'search.placeholder' | 'search.clear' | 'search.noMatches' | 'search.unavailable' | 'search.pending' | 'search.hasMore' | 'search.results.aria' | 'workspace.add' | 'workspace.addBusy' | 'workspace.addError' | 'workspace.addErrorTitle' | 'workspace.rename' | 'workspace.delete' | 'workspace.deleteTitle' | 'workspace.deleteConfirm' | 'workspace.deleteCancel' | 'workspace.renaming' | 'workspace.deleting' | 'workspace.renameTitle' | 'workspace.renamePlaceholder' | 'workspace.renameConfirm' | 'workspace.renameCancel' | 'workspace.moveOutOfGroup' | 'workspace.openInFolder' | 'workspace.openInFolderError' | 'group.create' | 'group.createTitle' | 'group.createPlaceholder' | 'group.createConfirm' | 'group.createCancel' | 'group.rename' | 'group.renameTitle' | 'group.renameConfirm' | 'group.delete' | 'group.deleteTitle' | 'group.deleteConfirm' | 'group.deleteCancel' | 'group.nameDuplicate' | 'group.nameReserved' | 'section.topLevel' | 'manual.saveError' | 'session.new' | 'session.rename' | 'session.archive' | 'session.fork' | 'session.renameTitle' | 'session.renamePlaceholder' | 'session.renameConfirm' | 'session.renameCancel' | 'session.renaming' | 'uncategorized' | 'empty.none' | 'empty.noWorkspaces' | 'close' | 'cancel' | 'confirm' | 'retry' | 'configUnavailable' | 'collapse' | 'expandMore' | 'newSession' | 'quick.title' | 'quick.tab.workspaces' | 'quick.tab.sessions' | 'quick.search.placeholder' | 'quick.search.sessions' | 'quick.empty.workspaces' | 'quick.action.newSession' | 'quick.action.running' | 'quick.action.noneRunning' | 'quick.empty.sessions' | 'quick.select.hint' | 'quick.hint' | 'tabs.aria' | 'tabs.close' | 'tabs.archive';
export type WorkspaceGroupsDict = LocaleDictOf<'workspaceGroups'>;
/** Simplified Chinese dictionary. */
export declare const zh: WorkspaceGroupsDict;
/** English dictionary. */
export declare const en: WorkspaceGroupsDict;

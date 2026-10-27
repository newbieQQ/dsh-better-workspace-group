/**
 * Locale dictionaries for the workspace-groups browser. The namespace is
 * `workspaceGroups` (independent from ui-workspace's `workspace` namespace).
 */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary keys of the workspaceGroups namespace (single source of truth). */
export type WorkspaceGroupsKey =
  | 'section.workspaces'
  | 'section.sessions'
  | 'search'
  | 'search.placeholder'
  | 'search.clear'
  | 'search.noMatches'
  | 'search.unavailable'
  | 'search.pending'
  | 'search.hasMore'
  | 'search.results.aria'
  | 'workspace.add'
  | 'workspace.addBusy'
  | 'workspace.addError'
  | 'workspace.addErrorTitle'
  | 'workspace.rename'
  | 'workspace.delete'
  | 'workspace.deleteTitle'
  | 'workspace.deleteConfirm'
  | 'workspace.deleteCancel'
  | 'workspace.renaming'
  | 'workspace.deleting'
  | 'workspace.renameTitle'
  | 'workspace.renamePlaceholder'
  | 'workspace.renameConfirm'
  | 'workspace.renameCancel'
  | 'workspace.moveOutOfGroup'
  | 'workspace.openInFolder'
  | 'workspace.openInFolderError'
  | 'group.create'
  | 'group.createTitle'
  | 'group.createPlaceholder'
  | 'group.createConfirm'
  | 'group.createCancel'
  | 'group.rename'
  | 'group.renameTitle'
  | 'group.renameConfirm'
  | 'group.delete'
  | 'group.deleteTitle'
  | 'group.deleteConfirm'
  | 'group.deleteCancel'
  | 'group.nameDuplicate'
  | 'group.nameReserved'
  | 'section.topLevel'
  | 'manual.saveError'
  | 'session.new'
  | 'session.rename'
  | 'session.archive'
  | 'session.fork'
  | 'session.renameTitle'
  | 'session.renamePlaceholder'
  | 'session.renameConfirm'
  | 'session.renameCancel'
  | 'session.renaming'
  | 'uncategorized'
  | 'empty.none'
  | 'empty.noWorkspaces'
  | 'close'
  | 'cancel'
  | 'confirm'
  | 'retry'
  | 'configUnavailable'
  | 'collapse'
  | 'expandMore'
  | 'newSession'
  | 'quick.title'
  | 'quick.tab.workspaces'
  | 'quick.tab.sessions'
  | 'quick.search.placeholder'
  | 'quick.search.sessions'
  | 'quick.empty.workspaces'
  | 'quick.action.newSession'
  | 'quick.action.running'
  | 'quick.action.noneRunning'
  | 'quick.empty.sessions'
  | 'quick.select.hint'
  | 'quick.hint'
  | 'tabs.aria'
  | 'tabs.close'
  | 'tabs.archive'

export type WorkspaceGroupsDict = LocaleDictOf<'workspaceGroups'>

/** Simplified Chinese dictionary. */
export const zh: WorkspaceGroupsDict = {
  'section.workspaces': '工作区',
  'section.sessions': '会话',
  search: '搜索',
  'search.placeholder': '搜索会话…',
  'search.clear': '清除',
  'search.noMatches': '没有匹配的会话',
  'search.unavailable': '搜索不可用',
  'search.pending': '搜索中…',
  'search.hasMore': '结果过多，请细化关键词',
  'search.results.aria': '搜索结果',
  'workspace.add': '添加工作区',
  'workspace.addBusy': '正在添加…',
  'workspace.addError': '添加失败',
  'workspace.addErrorTitle': '无法添加工作区',
  'workspace.rename': '重命名',
  'workspace.delete': '删除',
  'workspace.deleteTitle': '删除工作区',
  'workspace.deleteConfirm': '仅删除注册信息，目录与会话日志保留。确定删除？',
  'workspace.deleteCancel': '取消删除',
  'workspace.renaming': '重命名中…',
  'workspace.deleting': '删除中…',
  'workspace.renameTitle': '重命名工作区',
  'workspace.renamePlaceholder': '工作区名称',
  'workspace.renameConfirm': '重命名',
  'workspace.renameCancel': '取消',
  'workspace.moveOutOfGroup': '移出分组',
  'workspace.openInFolder': '在文件夹中打开',
  'workspace.openInFolderError': '打开文件夹失败',
  'group.create': '新建分组',
  'group.createTitle': '新建分组',
  'group.createPlaceholder': '分组名称',
  'group.createConfirm': '创建',
  'group.createCancel': '取消',
  'group.rename': '重命名分组',
  'group.renameTitle': '重命名分组',
  'group.renameConfirm': '重命名',
  'group.delete': '删除分组',
  'group.deleteTitle': '删除分组',
  'group.deleteConfirm': '删除后，该分组内的所有项目将移到顶层（不归组）。确定删除？',
  'group.deleteCancel': '取消删除',
  'group.nameDuplicate': '已存在同名分组',
  'group.nameReserved': '该名称不可用',
  'section.topLevel': '顶层项目',
  'manual.saveError': '分组变更保存失败',
  'session.new': '新建会话',
  'session.rename': '重命名会话',
  'session.archive': '归档',
  'session.fork': '派生',
  'session.renameTitle': '重命名会话',
  'session.renamePlaceholder': '会话名称',
  'session.renameConfirm': '重命名',
  'session.renameCancel': '取消',
  'session.renaming': '重命名中…',
  uncategorized: '未分类',
  'empty.none': '暂无内容',
  'empty.noWorkspaces': '还没有工作区',
  close: '关闭',
  cancel: '取消',
  confirm: '确定',
  retry: '重试',
  configUnavailable: '分组配置不可用',
  collapse: '折叠',
  expandMore: '展开全部',
  newSession: '新建会话',
  'quick.title': '快速切换',
  'quick.tab.workspaces': '工作区',
  'quick.tab.sessions': '全部会话',
  'quick.search.placeholder': '搜索工作区…',
  'quick.search.sessions': '搜索会话…',
  'quick.empty.workspaces': '没有匹配的工作区',
  'quick.action.newSession': '新建会话',
  'quick.action.running': '切到运行中的会话',
  'quick.action.noneRunning': '没有正在运行的会话',
  'quick.empty.sessions': '还没有会话',
  'quick.select.hint': '在上方选择一个工作区',
  'quick.hint': 'Ctrl+R 开关 · Enter 打开/新建 · Esc 关闭',
  'tabs.aria': '已打开的会话',
  'tabs.close': '关闭标签',
  'tabs.archive': '归档',
}

/** English dictionary. */
export const en: WorkspaceGroupsDict = {
  'section.workspaces': 'Workspaces',
  'section.sessions': 'Sessions',
  search: 'Search',
  'search.placeholder': 'Search sessions…',
  'search.clear': 'Clear',
  'search.noMatches': 'No matching sessions',
  'search.unavailable': 'Search unavailable',
  'search.pending': 'Searching…',
  'search.hasMore': 'Too many results — refine the query',
  'search.results.aria': 'Search results',
  'workspace.add': 'Add workspace',
  'workspace.addBusy': 'Adding…',
  'workspace.addError': 'Add failed',
  'workspace.addErrorTitle': 'Could not add workspace',
  'workspace.rename': 'Rename',
  'workspace.delete': 'Delete',
  'workspace.deleteTitle': 'Delete workspace',
  'workspace.deleteConfirm': 'Only the registration is removed; the directory and session logs stay. Delete?',
  'workspace.deleteCancel': 'Cancel delete',
  'workspace.renaming': 'Renaming…',
  'workspace.deleting': 'Deleting…',
  'workspace.renameTitle': 'Rename workspace',
  'workspace.renamePlaceholder': 'Workspace name',
  'workspace.renameConfirm': 'Rename',
  'workspace.renameCancel': 'Cancel',
  'workspace.moveOutOfGroup': 'Move out of group',
  'workspace.openInFolder': 'Open in folder',
  'workspace.openInFolderError': 'Could not open the folder',
  'group.create': 'New group',
  'group.createTitle': 'New group',
  'group.createPlaceholder': 'Group name',
  'group.createConfirm': 'Create',
  'group.createCancel': 'Cancel',
  'group.rename': 'Rename group',
  'group.renameTitle': 'Rename group',
  'group.renameConfirm': 'Rename',
  'group.delete': 'Delete group',
  'group.deleteTitle': 'Delete group',
  'group.deleteConfirm': 'Deleting removes this group; every project inside it moves to the top level (ungrouped). Delete?',
  'group.deleteCancel': 'Cancel delete',
  'group.nameDuplicate': 'A group with this name already exists',
  'group.nameReserved': 'This name is not available',
  'section.topLevel': 'Top-level projects',
  'manual.saveError': 'Could not save group changes',
  'session.new': 'New Session',
  'session.rename': 'Rename session',
  'session.archive': 'Archive',
  'session.fork': 'Fork',
  'session.renameTitle': 'Rename session',
  'session.renamePlaceholder': 'Session name',
  'session.renameConfirm': 'Rename',
  'session.renameCancel': 'Cancel',
  'session.renaming': 'Renaming…',
  uncategorized: 'Uncategorized',
  'empty.none': 'Nothing here',
  'empty.noWorkspaces': 'No workspaces yet',
  close: 'Close',
  cancel: 'Cancel',
  confirm: 'Confirm',
  retry: 'Retry',
  configUnavailable: 'Grouping config unavailable',
  collapse: 'Collapse',
  expandMore: 'Show all',
  newSession: 'New Session',
  'quick.title': 'Quick switch',
  'quick.tab.workspaces': 'Workspaces',
  'quick.tab.sessions': 'All sessions',
  'quick.search.placeholder': 'Search workspaces…',
  'quick.search.sessions': 'Search sessions…',
  'quick.empty.workspaces': 'No matching workspaces',
  'quick.action.newSession': 'New Session',
  'quick.action.running': 'Switch to running session',
  'quick.action.noneRunning': 'No running session',
  'quick.empty.sessions': 'No sessions yet',
  'quick.select.hint': 'Pick a workspace above',
  'quick.hint': 'Ctrl+R toggle · Enter open/new · Esc close',
  'tabs.aria': 'Open sessions',
  'tabs.close': 'Close tab',
  'tabs.archive': 'Archive',
}

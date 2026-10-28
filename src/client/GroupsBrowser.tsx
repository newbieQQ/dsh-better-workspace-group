/**
 * The workspace-groups browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + right-aligned search +
 * new-group + add workspace), the three-level tree (category — workspace —
 * session), group management dialogs, and the workspace/session dialogs. Wide
 * state renders the full browser; rail state renders the two region icons
 * (search / add workspace) as 36px controls on the shell's shared rail entry
 * path, each requesting expansion through the owner share.
 *
 * Data: workspaces/sessions via the framework global hooks; grouping config
 * via the host half's `/workspace-groups/config` route (refetched on mount).
 * Runtime group management (create/rename/delete any group, drag workspaces
 * between groups and into position, drag groups into position) persists
 * through `PUT /workspace-groups/manual`; the sidecar YAML is never rewritten
 * (rule-group rename/delete ride the overlay `renamed`/`hidden` maps).
 */
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Button,
  IconCloseFillMedium,
  IconFolderOpenOutlineRegular,
  IconProjectAddOutlineRegular,
  IconSearchOutlineRegular,
  IconTrashOutlineRegular,
  IconWarningOutlineRegular,
  Modal,
  Toast,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SessionSearchResultItem } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import {
  displayCategoryKeys,
  isCategoryPinned,
  moveAfter,
  moveBefore,
  originalRuleNameForDisplay,
  pruneAppearance,
  resolveCategory,
  takenCategoryNames,
} from '../core/matcher.ts'
import {
  GROUP_COLORS,
  GROUP_ICON_IDS,
  TOP_LEVEL_ORDER_KEY,
  UNCATEGORIZED_LABEL,
  type CategoryAppearance,
  type GroupColor,
  type GroupsConfig,
  type ManualGroups,
} from '../core/types.ts'
import type { GroupsBrowserProps } from './contract.ts'
import { deriveGroups, deriveSearchGroups, deriveSearchMatches, deriveTopLevel, currentSessionId, folderKey, folderLabel, UNCATEGORIZED_KEY, type CategoryNode, type WorkspaceGroupNode } from './tree.ts'
import { CategoryGlyph, CategoryRow, DND_CATEGORY_TYPE, DND_WORKSPACE_TYPE, FolderRow, hasPluginDragType, RowGroup, SessionRow, WorkspaceRow } from './rows.tsx'
import type { WorkspaceGroupsKey } from './locales.ts'
import { EMPTY_FOLDERS_DOCUMENT, addFolder, effectiveFolders, entryFor, isUnderBase, joinSubpath, removeFolder, rootOf, samePath, setRoot, type FoldersDocument, type WorkspaceFolderEntry } from '../core/folders.ts'
import { ensureRemoteFolderMarker, loadFolders, saveFolders } from './folders-persist.ts'
import { fetchOpenInApps, folderAppId, openPathInApp } from './open-folder.ts'
import { QuickPanel } from './QuickPanel.tsx'
import { SessionTabs } from './SessionTabs.tsx'
import { FlowerBranch } from './FlowerBranch.tsx'
import css from './styles.css?inline'

const SEARCH_DEBOUNCE_MS = 250
const SEARCH_QUERY_MAX_CODE_UNITS = 500

/** Overlay with every optional field materialized (plain-object edits, no undefined spreads). */
type NormalizedManual = Required<ManualGroups>

const EMPTY_MANUAL: NormalizedManual = {
  categories: [], assignments: {}, categoryOrder: [], workspaceOrder: {}, renamed: {}, hidden: [], appearance: {},
}

/** Materialize optional overlay fields so every update is a plain object edit. */
function normalizeManual(manual: ManualGroups): NormalizedManual {
  return {
    categories: manual.categories,
    assignments: manual.assignments,
    categoryOrder: manual.categoryOrder ?? [],
    workspaceOrder: manual.workspaceOrder ?? {},
    renamed: manual.renamed ?? {},
    hidden: manual.hidden ?? [],
    appearance: manual.appearance ?? {},
  }
}

/**
 * Largest subtree (rows including the level header) that still animates: a
 * 100-session project expanding with a grid animation janks the sidebar, so
 * wide subtrees snap open instead.
 */
const ANIMATION_ROW_CAP = 40

/**
 * Mirrors the host icon validator (`parseAppearance`) so invalid custom glyphs
 * fail locally instead of turning the whole overlay PUT into a 400.
 */
const ICON_VALUE_PATTERN = /^(?:[a-z][a-z0-9-]{0,23}|[^\s\u0000-\u001f\u007f]{1,4})$/u

/** Rows a group reveals when expanded (projects + their visible sessions). */
function categoryRowCount(category: CategoryNode): number {
  return category.workspaces.reduce((total, workspace) => total + 1 + (workspace.expanded ? workspace.sessions.length : 0), 0)
}

/** Palette id — i18n key for the colour picker (keeps literal key types intact). */
const COLOR_LABEL_KEYS: Record<GroupColor, WorkspaceGroupsKey> = {
  red: 'color.red',
  orange: 'color.orange',
  amber: 'color.amber',
  green: 'color.green',
  teal: 'color.teal',
  blue: 'color.blue',
  indigo: 'color.indigo',
  purple: 'color.purple',
  pink: 'color.pink',
  gray: 'color.gray',
}

function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  return withoutNul.slice(0, SEARCH_QUERY_MAX_CODE_UNITS)
}

/** Immutable membership toggle for the local expand-all array. */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

/** Light runtime guard for the manual overlay attached to the config fetch. */
function isManualGroups(value: unknown): value is ManualGroups {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { categories?: unknown; assignments?: unknown }
  return Array.isArray(candidate.categories) && typeof candidate.assignments === 'object' && candidate.assignments !== null
}

/** Minimal fetch of the grouping config + runtime overlay (no-cache revalidation). */
async function fetchGroupsConfig(): Promise<{ config: GroupsConfig; manual: NormalizedManual }> {
  const response = await fetch('/workspace-groups/config', { cache: 'no-cache' })
  if (!response.ok) throw new Error(`config request failed: ${response.status}`)
  const body = (await response.json()) as GroupsConfig
  const config: GroupsConfig = Array.isArray(body.categories) ? body : { categories: [] }
  return { config, manual: isManualGroups(body.manual) ? normalizeManual(body.manual) : EMPTY_MANUAL }
}

/** Persist the whole runtime overlay (idempotent; the host validates + writes). */
async function saveManualOverlay(manual: ManualGroups): Promise<void> {
  const response = await fetch('/workspace-groups/manual', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manual),
  })
  if (!response.ok) {
    let message = `manual save failed: ${response.status}`
    try {
      const text = await response.text()
      if (text !== '') message = text
    } catch { /* keep the fallback message */ }
    throw new Error(message)
  }
}

/** One group-management dialog state: create, or rename an existing group. */
type GroupDialogState = { mode: 'create' } | { mode: 'rename'; from: string } | null

/** Row reference used by drop targets: which kind of row, which key. */
export type DropRowRef = { kind: 'category' | 'workspace' | 'topLevel'; key: string }

/**
 * Which level's rows fold while a drag is in progress: dragging a project
 * folds every project row (grouped AND top-level), dragging a group folds
 * every group row. The other level keeps its expansion untouched.
 */
export type DragLevel = 'workspace' | 'category' | null

/**
 * Current drop indicator. A `line` renders a 2px insertion line above/below a
 * row (project reorder inside a group, or group reorder); an `into` renders
 * the whole-row highlight used when dropping a project into a group. Drop
 * handlers re-derive before/after from the drop event itself, so the
 * indicator is purely visual and can never go stale.
 */
export type DragIndicator =
  | { mode: 'line'; row: DropRowRef; before: boolean }
  | { mode: 'into'; categoryKey: string }
  | null

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function GroupsBrowser({
  wide,
  expandSidebar,
  useSessions,
  useWorkspaces,
  useSessionStatus,
  useStore,
  actions,
  startSession,
  createSessionIn,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  insertSessionBefore,
  createWorkspace,
  pickDirectory,
  searchSessions,
  searchResultLimit,
  openTab,
  useTabs,
  tabActions,
  t,
}: GroupsBrowserProps) {
  // Inject the stylesheet once per fiber; dispose removes it (HMR safe).
  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-workspace-groups')
    style.textContent = css
    document.head.append(style)
    return () => { style.remove() }
  }, [])

  // Ctrl+R toggles the quick switch panel. Capture phase + preventDefault:
  // beats the browser's page-reload default and any shell-level handler.
  const [quickOpen, setQuickOpen] = useState(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        e.stopPropagation()
        setQuickOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Grouping config from the host route + the runtime manual overlay.
  const [config, setConfig] = useState<GroupsConfig>({ categories: [] })
  const [manual, setManual] = useState<NormalizedManual>(EMPTY_MANUAL)
  const [configError, setConfigError] = useState<string | null>(null)
  const reloadConfig = () => {
    setConfigError(null)
    fetchGroupsConfig().then(({ config: nextConfig, manual: nextManual }) => {
      setConfig(nextConfig)
      setManual(nextManual)
    }).catch((reason: unknown) => {
      setConfigError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  useEffect(() => { reloadConfig() }, [])

  // Transient save errors for drag/menu group operations (dialog errors are local).
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualSaving, setManualSaving] = useState(false)

  // ---- Per-workspace folders (multi-root) -------------------------------------
  //
  // A second host sidecar (`/workspace-groups/folders`) lists each workspace's
  // extra folders plus the optional root folder. It is read once per mount and
  // written back whole, like the manual overlay above; a failed write is a
  // toast rather than a banner because every edit here is a one-off row action.
  const [foldersDoc, setFoldersDoc] = useState<FoldersDocument>(EMPTY_FOLDERS_DOCUMENT)
  // Folder collapse is component state, not store state: it is a transient view
  // of the row list, like the quick panel, so it is deliberately NOT persisted
  // with the category/workspace expansion keys. Folders start expanded, so
  // attaching a folder never hides sessions the user could already see.
  const [collapsedFolderKeys, setCollapsedFolderKeys] = useState<readonly string[]>([])
  const [foldersTarget, setFoldersTarget] = useState<WorkspaceId | null>(null)
  const [foldersBusy, setFoldersBusy] = useState(false)
  const [creatingSessionIn, setCreatingSessionIn] = useState<string | null>(null)
  // Local mirror root of the remote-ssh plugin, as reported by the host. A
  // project whose directory lives below it is a REMOTE workspace: its folder is
  // a mirror of one remote root, so extra folders must be subdirectories of that
  // mirror — anything else would exist on this machine only.
  const [foldersRemoteBase, setFoldersRemoteBase] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadFolders().then((snapshot) => {
      if (cancelled) return
      setFoldersDoc(snapshot.document)
      setFoldersRemoteBase(snapshot.remoteBase ?? null)
    })
    return () => { cancelled = true }
  }, [])

  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const categoryExpansion = useStore(s => s.categoryExpansion)
  const workspaceExpansion = useStore(s => s.workspaceExpansion)

  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  // 0.1.6: the selected Session is the one retained through `mainView`, not a
  // `list.current` field (the list snapshot carries catalog facts only).
  const current = currentSessionId(list)
  const currentWorkspaceKey = current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(current as SessionId))?.workspaceId as string | undefined)

  // Whether the open session is WORKING right now, which is what makes the
  // flower at the branch's endpoint turn. Read from the unified status snapshot
  // (the catalog summary alone goes stale), folded together with the session's
  // own `running` so a subagent-only turn still counts.
  //
  // Derived as a boolean on purpose: the overlay re-measures through its own
  // MutationObserver, so handing it a live value would re-render the tree on
  // every status tick.
  const currentRunning = current !== undefined
    && ((statuses.get(current)?.running ?? false) || (list.byId[current]?.running ?? false))

  // Auto-expand the category + workspace containing the current session, but
  // ONLY when the user has never touched that key (`Object.hasOwn`): a
  // present `false` is a deliberate collapse and must stay folded. Without
  // this guard the effect re-expands the just-collapsed current category on
  // every store change (the reported "cannot collapse" bug).
  useEffect(() => {
    if (current === undefined || currentWorkspaceKey === undefined) return
    const category = categoriesForCurrent(config, workspaces, current, manual)
    if (category !== undefined && !Object.hasOwn(categoryExpansion, category)) {
      actions.setCategoryExpanded(category, true)
    }
    if (!Object.hasOwn(workspaceExpansion, currentWorkspaceKey)) {
      actions.setWorkspaceExpanded(currentWorkspaceKey, true)
    }
  }, [current, currentWorkspaceKey, config, workspaces, manual, categoryExpansion, workspaceExpansion, actions])

  // Drop expansion keys that no longer exist (group edits / workspace deletion).
  useEffect(() => {
    if (workspacePhase !== 'ready') return
    actions.retainKeys(
      displayCategoryKeys(config, manual),
      workspaces.map(w => w.workspaceId as string),
    )
  }, [actions, config, manual, workspacePhase, workspaces])

  // Session tabs: the strip lives in the conversation column, but its lifecycle
  // belongs here — the browser already derives the open session for its own tree,
  // so one effect covers every way a session can be opened (sidebar row,
  // workspace New Session, quick panel, conversation-header crumbs).
  //
  // `statuses` is a dependency on purpose: a session earns its tab when it
  // STARTS working, which is a status change, not a catalog change. Without it a
  // conversation that began while already open would never surface a tab.
  useEffect(() => {
    if (current === undefined) return
    openTab(current, statuses.get(current))
  }, [current, list, statuses, openTab])

  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  const [remoteSearch, setRemoteSearch] = useState<RemoteSearchState>({
    query: '', status: 'idle', items: [], hasMore: false,
  })
  const searchInput = useRef<HTMLInputElement | null>(null)
  const searchRoot = useRef<HTMLDivElement | null>(null)
  // Box the flower branch measures and paints into. Held as a ref (not state)
  // because the overlay re-measures on its own MutationObserver; a state update
  // here would re-render the whole tree on every layout tick.
  const branchScope = useRef<HTMLDivElement | null>(null)

  // Search debounce + abort, same posture as the official browser.
  useEffect(() => {
    if (normalizedQuery === '') {
      setRemoteSearch({ query: '', status: 'idle', items: [], hasMore: false })
      return
    }
    const controller = new AbortController()
    setRemoteSearch({ query: normalizedQuery, status: 'loading', items: [], hasMore: false })
    const timer = window.setTimeout(() => {
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        setRemoteSearch({ query: normalizedQuery, status: 'ready', items: result.items, hasMore: result.hasMore })
      }).catch(() => {
        if (controller.signal.aborted) return
        setRemoteSearch({ query: normalizedQuery, status: 'error', items: [], hasMore: false })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedQuery, searchSessions])

  // Outside-click dismissal of the search box.
  useEffect(() => {
    if (!wide || !searchExpanded) return
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return
      searchInput.current?.blur()
      if (normalizedQuery !== '') return
      setSearchExpanded(false)
    }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick) }
  }, [normalizedQuery, wide, searchExpanded])

  const expandedCategories = useMemo(
    () => Object.entries(categoryExpansion).filter(([, v]) => v).map(([k]) => k),
    [categoryExpansion],
  )
  const expandedWorkspaces = useMemo(
    () => Object.entries(workspaceExpansion).filter(([, v]) => v).map(([k]) => k),
    [workspaceExpansion],
  )
  // Which level is being dragged: drives the top-level drop target (project
  // drags only) and which level's rows fold.
  const [dragging, setDragging] = useState<DragLevel>(null)
  const groups = useMemo(
    () => deriveGroups(list, workspaces, archivedSessionIds, config, {
      expandedCategories,
      expandedWorkspaces,
      collapsedFolders: collapsedFolderKeys,
    }, manual, statuses, foldersDoc),
    [list, workspaces, archivedSessionIds, config, manual, statuses, expandedCategories, expandedWorkspaces, collapsedFolderKeys, foldersDoc],
  )
  // Top-level (ungrouped) workspace rows, rendered after the group folders.
  const topLevel = useMemo(
    () => deriveTopLevel(list, workspaces, archivedSessionIds, config, {
      expandedCategories,
      expandedWorkspaces,
      collapsedFolders: collapsedFolderKeys,
    }, manual, statuses, foldersDoc),
    [list, workspaces, archivedSessionIds, config, manual, statuses, expandedCategories, expandedWorkspaces, collapsedFolderKeys, foldersDoc],
  )
  // Quick panel (Ctrl+R): category label per grouped workspace id (the tree
  // derivation already resolved grouping; top-level workspaces stay absent).
  const categoryByWorkspace = useMemo(() => {
    const map = new Map<string, string>()
    for (const category of groups) {
      for (const workspace of category.workspaces) map.set(workspace.workspaceId as string, category.label)
    }
    return map
  }, [groups])
  // While dragging a project, an empty top-level area must still show a landing
  // line — otherwise a project can never be dragged OUT of a group when every
  // project is currently grouped.
  const topLevelDropActive = dragging === 'workspace' && topLevel.length === 0
  // The top-level area is the move-out landing spot: rows reorder with an
  // insertion line (before/after), and the blank space below the last row
  // appends to the end of the list. No whole-area highlight box.
  const topLevelRef: DropRowRef = { kind: 'topLevel', key: UNCATEGORIZED_KEY }

  // Add workspace flow: self-contained (no directory-flow hole dependency).
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addErrorOpen, setAddErrorOpen] = useState(false)
  const addWorkspace = async (): Promise<void> => {
    if (adding) return
    setAdding(true)
    setAddError(null)
    setAddErrorOpen(false)
    try {
      const path = await pickDirectory()
      if (path === null) return // cancelled
      const workspace = await createWorkspace({ path })
      startSession(workspace.workspaceId)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setAddError(message)
      setAddErrorOpen(true)
    } finally {
      setAdding(false)
    }
  }

  // Workspace rename dialog.
  const [renameTarget, setRenameTarget] = useState<{ workspaceId: WorkspaceId; currentTitle: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameTrimmed = renameDraft.trim()
  const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
    && workspaces.some(w => w.title === renameTrimmed)
  const renameBlocked = renaming || renameTrimmed === '' || renameTarget === null
    || renameTrimmed === renameTarget.currentTitle || renameDuplicate
  const confirmRename = () => {
    if (renameBlocked || renameTarget === null) return
    setRenaming(true)
    setRenameError(null)
    renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      setRenaming(false)
      setRenameTarget(null)
    }).catch((reason: unknown) => {
      setRenaming(false)
      setRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Workspace delete dialog.
  const [deleteTarget, setDeleteTarget] = useState<{ workspaceId: WorkspaceId; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const confirmDelete = () => {
    if (deleting || deleteTarget === null) return
    setDeleting(true)
    setDeleteError(null)
    deleteWorkspace(deleteTarget.workspaceId).then(() => {
      setDeleting(false)
      setDeleteTarget(null)
    }).catch((reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // Session rename dialog.
  const [sessionRenameTarget, setSessionRenameTarget] = useState<{ sessionId: SessionId; currentTitle: string } | null>(null)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenaming, setSessionRenaming] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState<string | null>(null)
  const sessionRenameTrimmed = sessionRenameDraft.trim()
  const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null
  const confirmSessionRename = () => {
    if (sessionRenameBlocked || sessionRenameTarget === null) return
    setSessionRenaming(true)
    setSessionRenameError(null)
    renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      setSessionRenaming(false)
      setSessionRenameTarget(null)
    }).catch((reason: unknown) => {
      setSessionRenaming(false)
      setSessionRenameError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const onSessionRename = (sessionId: SessionId, currentTitle: string) => {
    setSessionRenameTarget({ sessionId, currentTitle })
    setSessionRenameDraft(currentTitle)
    setSessionRenameError(null)
  }

  // The strip is a child of this component (rendered through a DOM portal), so
  // it shares this fiber's props directly: renames call the dialog owner here,
  // and activation goes through the same navigation verb the sidebar rows use.
  const activateTab = (sessionId: SessionId) => { open(sessionId) }

  const onSessionArchive = (sessionId: SessionId) => {
    archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  // "Open in folder": the host half of the official open-in-app plugin resolves
  // which applications it can launch; the project row then just posts the
  // project directory to that host's launch route. One availability read per
  // mount — a host without the capability (or a refused read) leaves
  // `folderApp` undefined, which drops the menu entry rather than failing.
  const [folderApp, setFolderApp] = useState<string | undefined>(undefined)
  const [folderError, setFolderError] = useState<{ id: number; text: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchOpenInApps(controller.signal).then((apps) => {
      if (controller.signal.aborted) return
      setFolderApp(folderAppId(apps))
    }).catch(() => { /* no capability: the row simply offers no folder entry */ })
    return () => { controller.abort() }
  }, [])

  const openInFolder = folderApp === undefined
    ? undefined
    : (workspaceId: WorkspaceId): void => {
        const workspace = workspaces.find(w => w.workspaceId === workspaceId)
        if (workspace === undefined) return
        openPathInApp(folderApp, workspace.path).catch((reason: unknown) => {
          const detail = reason instanceof Error ? reason.message : String(reason)
          setFolderError({ id: Date.now(), text: `${t('workspace.openInFolderError')}: ${detail}` })
        })
      }

  // ---- Folder overlay editing -------------------------------------------------

  const notifyFolder = (text: string): void => {
    setFolderError({ id: Date.now(), text })
  }

  const persistFolders = (next: FoldersDocument): void => {
    setFoldersDoc(next)
    saveFolders(next).catch((reason: unknown) => {
      const detail = reason instanceof Error ? reason.message : String(reason)
      notifyFolder(`${t('folder.saveError')}: ${detail}`)
    })
  }

  /** Write one workspace's entry; zero extra folders removes the key entirely. */
  const writeFolderEntry = (workspaceId: WorkspaceId, entry: WorkspaceFolderEntry): void => {
    const next: Record<string, WorkspaceFolderEntry> = { ...foldersDoc.workspaces }
    const key = workspaceId as string
    if (entry.folders.length === 0) delete next[key]
    else next[key] = entry
    persistFolders({ version: 1, workspaces: next })
  }

  const toggleFolder = (workspaceId: WorkspaceId, path: string): void => {
    const key = folderKey(workspaceId, path)
    setCollapsedFolderKeys(keys => (keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]))
  }

  const isRemoteWorkspace = (workspace: WorkspaceView): boolean => (
    foldersRemoteBase !== null && isUnderBase(workspace.path, foldersRemoteBase)
  )

  const addFolderTo = async (workspaceId: WorkspaceId): Promise<void> => {
    if (foldersBusy) return
    const workspace = workspaces.find(w => w.workspaceId === workspaceId)
    if (workspace === undefined) return
    // A remote workspace's directory is a local MIRROR of one remote root; the
    // native picker would happily return an unrelated local directory that has
    // no remote counterpart, so that path is closed off here and the dialog
    // takes a subpath instead.
    if (isRemoteWorkspace(workspace)) {
      notifyFolder(t('folder.remoteNeedsSubpath'))
      return
    }
    setFoldersBusy(true)
    try {
      const path = await pickDirectory()
      if (path === null) return // cancelled
      const entry = entryFor(foldersDoc, workspaceId as string)
      if (effectiveFolders(workspace.path, entry).some(folder => samePath(folder, path))) {
        notifyFolder(t('folder.duplicate'))
        return
      }
      writeFolderEntry(workspaceId, addFolder(entry, path))
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason)
      notifyFolder(`${t('folder.addError')}: ${detail}`)
    } finally {
      setFoldersBusy(false)
    }
  }

  /**
   * Add a folder to a REMOTE workspace by typing a path relative to its mirror.
   * The mirror is a copy of the remote root, so `<mirror>/sub` and remote `sub`
   * are the same directory — that is the only way an extra folder can mean
   * something on both sides.
   */
  const addSubpathTo = (workspaceId: WorkspaceId, relative: string): void => {
    if (foldersBusy) return
    const workspace = workspaces.find(w => w.workspaceId === workspaceId)
    if (workspace === undefined) return
    const path = joinSubpath(workspace.path, relative)
    if (path === null) {
      notifyFolder(t('folder.subpathInvalid'))
      return
    }
    const entry = entryFor(foldersDoc, workspaceId as string)
    if (effectiveFolders(workspace.path, entry).some(folder => samePath(folder, path))) {
      notifyFolder(t('folder.duplicate'))
      return
    }
    writeFolderEntry(workspaceId, addFolder(entry, path))
    // Mirror subdirectory: also stamp the remote-ssh record, otherwise the new
    // folder's sessions would lose the remote terminal (remote-ssh reads the
    // record at the cwd only). Fire and forget — the folder row already works.
    void ensureRemoteFolderMarker(workspace.path, path)
  }

  const setFolderRoot = (workspaceId: WorkspaceId, path: string): void => {
    writeFolderEntry(workspaceId, setRoot(entryFor(foldersDoc, workspaceId as string), path))
  }

  const removeFolderFrom = (workspaceId: WorkspaceId, path: string): void => {
    writeFolderEntry(workspaceId, removeFolder(entryFor(foldersDoc, workspaceId as string), path))
  }

  /**
   * "New session here": an extra folder's own directory becomes the Session cwd.
   * The base folder keeps the platform's own gesture instead, because that one
   * reuses the blank session it already opened; creating a fresh Session on
   * every click would pile up empty sessions. One creation in flight at a time;
   * a rejection surfaces the failure and creates nothing else.
   */
  const startSessionInFolder = (workspaceId: WorkspaceId, path: string, isBase: boolean): void => {
    if (isBase) {
      startSession(workspaceId)
      return
    }
    if (creatingSessionIn !== null) return
    setCreatingSessionIn(folderKey(workspaceId, path))
    createSessionIn(workspaceId, path).catch((reason: unknown) => {
      const detail = reason instanceof Error ? reason.message : String(reason)
      notifyFolder(`${t('folder.sessionError')}: ${detail}`)
    }).finally(() => {
      setCreatingSessionIn(null)
    })
  }

  /** A project row's plus button — starts in that workspace's root folder. */
  const startSessionAtRoot = (workspaceId?: WorkspaceId): void => {
    const workspace = workspaceId === undefined ? undefined : workspaces.find(w => w.workspaceId === workspaceId)
    if (workspace === undefined) {
      startSession(workspaceId)
      return
    }
    const root = rootOf(workspace.path, entryFor(foldersDoc, workspaceId as string))
    startSessionInFolder(workspaceId as WorkspaceId, root, samePath(root, workspace.path))
  }

  // Absent when the host offers no folder application: folder rows then drop
  // their "open folder" entry instead of failing at the click.
  const openFolderPath = folderApp === undefined
    ? undefined
    : (path: string): void => {
        openPathInApp(folderApp, path).catch((reason: unknown) => {
          const detail = reason instanceof Error ? reason.message : String(reason)
          notifyFolder(`${t('workspace.openInFolderError')}: ${detail}`)
        })
      }

  // ---- Runtime group management ----------------------------------------------

  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null)
  const [groupDraft, setGroupDraft] = useState('')
  const [groupError, setGroupError] = useState<string | null>(null)
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupDeleteTarget, setGroupDeleteTarget] = useState<string | null>(null)
  const [groupDeleting, setGroupDeleting] = useState(false)
  const [groupDeleteError, setGroupDeleteError] = useState<string | null>(null)

  // Appearance dialog (color / icon / pin) for one group display key. Every
  // control applies immediately (optimistic merge + save); there is no OK, so
  // `appearanceTarget` also doubles as the open flag.
  const [appearanceTarget, setAppearanceTarget] = useState<string | null>(null)
  const [appearanceDraft, setAppearanceDraft] = useState<CategoryAppearance>({})
  const [appearanceError, setAppearanceError] = useState<string | null>(null)

  const takenNames = useMemo(() => takenCategoryNames(config, manual), [config, manual])

  const groupTrimmed = groupDraft.trim()
  const groupNameIssue = groupDialog !== null && groupTrimmed !== ''
    ? (groupTrimmed === UNCATEGORIZED_LABEL
        ? t('group.nameReserved')
        : (groupDialog.mode === 'rename' && groupTrimmed === groupDialog.from)
          ? null
          : takenNames.has(groupTrimmed) ? t('group.nameDuplicate') : null)
    : null
  const groupBlocked = groupBusy || groupTrimmed === '' || groupNameIssue !== null
    || (groupDialog !== null && groupDialog.mode === 'rename' && groupTrimmed === groupDialog.from)

  const confirmGroupDialog = () => {
    if (groupBlocked || groupDialog === null) return
    const name = groupTrimmed
    const from = groupDialog.mode === 'rename' ? groupDialog.from : undefined
    const renaming = groupDialog.mode === 'rename' && from !== name

    let next: NormalizedManual
    if (groupDialog.mode === 'create') {
      next = { ...manual, categories: [...manual.categories, name] }
    } else {
      // Rename: rule groups ride the `renamed` map, manual groups the list;
      // every reference (assignments / workspaceOrder / categoryOrder) follows.
      const originalRule = from !== undefined ? originalRuleNameForDisplay(config.categories, manual, from) : undefined
      next = {
        ...manual,
        ...(originalRule !== undefined
          ? { renamed: { ...manual.renamed, [originalRule]: name } }
          : { categories: manual.categories.map(c => c === from ? name : c) }),
        assignments: Object.fromEntries(
          Object.entries(manual.assignments).map(([id, category]): [string, string | null] => [id, category === from ? name : category]),
        ),
        workspaceOrder: Object.fromEntries(
          Object.entries(manual.workspaceOrder).map(([key, ids]): [string, string[]] => [key === from ? name : key, ids]),
        ),
        categoryOrder: manual.categoryOrder.map(key => key === from ? name : key),
        // Appearance is keyed by display name too: move the entry instead of
        // leaving the colour/icon/pin behind under the old name.
        appearance: from === undefined || from === name
          ? manual.appearance
          : Object.fromEntries(
              Object.entries(manual.appearance).map(([key, value]): [string, CategoryAppearance] => [key === from ? name : key, value]),
            ),
      }
    }

    setGroupBusy(true)
    setGroupError(null)
    saveManualOverlay(next).then(() => {
      setManual(next)
      setManualError(null)
      setGroupBusy(false)
      setGroupDialog(null)
      setGroupDraft('')
      // Keep the renamed group open (its old expansion key is dropped by retainKeys).
      if (renaming) actions.setCategoryExpanded(name, true)
    }).catch((reason: unknown) => {
      setGroupBusy(false)
      setGroupError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const confirmGroupDelete = () => {
    if (groupDeleting || groupDeleteTarget === null) return
    const name = groupDeleteTarget
    const originalRule = originalRuleNameForDisplay(config.categories, manual, name)

    // Every project currently in the group goes to the uncategorized bucket (forced, not rule-
    // reclassified), regardless of how it landed there.
    const assignments = { ...manual.assignments }
    for (const workspace of workspaces) {
      if (resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title) === name) {
        assignments[workspace.workspaceId] = null
      }
    }
    const workspaceOrder = Object.fromEntries(
      Object.entries(manual.workspaceOrder).filter(([key]) => key !== name),
    )
    const next: NormalizedManual = {
      ...manual,
      assignments,
      workspaceOrder,
      categoryOrder: manual.categoryOrder.filter(key => key !== name),
      // Drop the presentation entry with the group itself (a dangling key would
      // silently re-attach if a new group ever reused the name).
      appearance: Object.fromEntries(
        Object.entries(manual.appearance).filter(([key]) => key !== name),
      ),
      ...(originalRule !== undefined
        ? {
            renamed: Object.fromEntries(Object.entries(manual.renamed).filter(([key]) => key !== originalRule)),
            hidden: [...manual.hidden, originalRule],
          }
        : { categories: manual.categories.filter(c => c !== name) }),
    }

    setGroupDeleting(true)
    setGroupDeleteError(null)
    saveManualOverlay(next).then(() => {
      setManual(next)
      setManualError(null)
      setGroupDeleting(false)
      setGroupDeleteTarget(null)
    }).catch((reason: unknown) => {
      setGroupDeleting(false)
      setGroupDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  // ---- Drag & drop (move/reorder workspaces, reorder groups) ------------------

  const [dragIndicator, setDragIndicator] = useState<DragIndicator>(null)

  // Expansion state taken at dragstart; dragend restores it so the folding
  // caused by a drag is always undone afterwards.
  const expansionSnapshot = useRef<{ categories: Record<string, boolean>; workspaces: Record<string, boolean> } | null>(null)
  // Live expansion state for the dragend restore (the document-level listener
  // is registered once, so it must read current values through a ref).
  const liveExpansionRef = useRef({ categoryExpansion, workspaceExpansion, actions })
  liveExpansionRef.current = { categoryExpansion, workspaceExpansion, actions }

  // Cancel any stale indicator when a drag ends outside a row (or is aborted),
  // and restore the expansion snapshot taken at dragstart.
  useEffect(() => {
    const clear = () => {
      setDragIndicator(null)
      setDragging(null)
      const snapshot = expansionSnapshot.current
      if (snapshot === null) return
      expansionSnapshot.current = null
      const { categoryExpansion: currentCategories, workspaceExpansion: currentWorkspaces, actions: currentActions } = liveExpansionRef.current
      for (const [key, value] of Object.entries(snapshot.categories)) {
        if (currentCategories[key] !== value) currentActions.setCategoryExpanded(key, value)
      }
      for (const [key, value] of Object.entries(snapshot.workspaces)) {
        if (currentWorkspaces[key] !== value) currentActions.setWorkspaceExpanded(key, value)
      }
    }
    document.addEventListener('dragend', clear)
    return () => { document.removeEventListener('dragend', clear) }
  }, [])

  /** Move a workspace into a category (or reorder inside it when `beforeWorkspaceId`/`afterWorkspaceId`). */
  const moveWorkspaceTo = async (workspaceId: string, categoryKey: string, beforeWorkspaceId?: string, afterWorkspaceId?: string): Promise<void> => {
    if (manualSaving) return
    const workspace = workspaces.find(w => w.workspaceId === workspaceId)
    if (workspace === undefined) return
    setManualSaving(true)
    try {
      let next: NormalizedManual
      if (categoryKey === UNCATEGORIZED_KEY) {
        // Move to the TOP LEVEL: force ungrouped (null) and drop from every
        // group's order list, while recording the position inside the ordered
        // top-level list (`workspaceOrder[TOP_LEVEL_ORDER_KEY]`).
        const assignments = { ...manual.assignments, [workspaceId]: null }
        const workspaceOrder: Record<string, string[]> = {}
        for (const [key, ids] of Object.entries(manual.workspaceOrder)) {
          if (key === TOP_LEVEL_ORDER_KEY) continue
          workspaceOrder[key] = ids.filter(id => id !== workspaceId)
        }
        const topLevelIds = workspaces
          .filter(w => w.workspaceId !== workspaceId && resolveCategory(config, manual, w.workspaceId, w.path, w.title) === undefined)
          .map(w => w.workspaceId as string)
        workspaceOrder[TOP_LEVEL_ORDER_KEY] = afterWorkspaceId !== undefined
          ? moveAfter(topLevelIds, workspaceId, afterWorkspaceId)
          : moveBefore(topLevelIds, workspaceId, beforeWorkspaceId)
        next = { ...manual, assignments, workspaceOrder }
      } else {
        const currentKey = resolveCategory(config, manual, workspaceId, workspace.path, workspace.title)
        const movingAcross = currentKey !== categoryKey
        const assignments = movingAcross
          ? { ...manual.assignments, [workspaceId]: categoryKey }
          : manual.assignments
        const targetOrder = afterWorkspaceId !== undefined
          ? moveAfter(manual.workspaceOrder[categoryKey] ?? [], workspaceId, afterWorkspaceId)
          : moveBefore(manual.workspaceOrder[categoryKey] ?? [], workspaceId, beforeWorkspaceId)
        const workspaceOrder = { ...manual.workspaceOrder, [categoryKey]: targetOrder }
        if (movingAcross && currentKey !== undefined && workspaceOrder[currentKey] !== undefined) {
          workspaceOrder[currentKey] = workspaceOrder[currentKey]!.filter(id => id !== workspaceId)
        }
        next = { ...manual, assignments, workspaceOrder }
      }
      await saveManualOverlay(next)
      setManual(next)
      setManualError(null)
      if (categoryKey !== UNCATEGORIZED_KEY) actions.setCategoryExpanded(categoryKey, true)
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setManualSaving(false)
    }
  }

  /** Reorder groups: move `draggedKey` before `beforeKey` or after `afterKey` (no target = append). */
  const moveCategory = async (draggedKey: string, beforeKey?: string, afterKey?: string): Promise<void> => {
    if (manualSaving || draggedKey === beforeKey || draggedKey === afterKey) return
    setManualSaving(true)
    try {
      const order = displayCategoryKeys(config, manual)
      const categoryOrder = afterKey !== undefined
        ? moveAfter(order, draggedKey, afterKey)
        : moveBefore(order, draggedKey, beforeKey)
      // Pinned groups sort before unpinned ones, so a drop across that boundary
      // only sticks when the dragged group adopts the neighbour's pin state in
      // the SAME write. Otherwise the derived order snaps it back and the drop
      // looks broken (spec §7.2).
      const neighbourKey = afterKey ?? beforeKey
      let appearance = manual.appearance
      if (neighbourKey !== undefined && isCategoryPinned(manual, neighbourKey) !== isCategoryPinned(manual, draggedKey)) {
        const cleaned = pruneAppearance({
          ...(manual.appearance[draggedKey] ?? {}),
          pinned: isCategoryPinned(manual, neighbourKey),
        })
        appearance = { ...manual.appearance }
        if (cleaned === undefined) delete appearance[draggedKey]
        else appearance[draggedKey] = cleaned
      }
      const next: NormalizedManual = { ...manual, categoryOrder, appearance }
      await saveManualOverlay(next)
      setManual(next)
      setManualError(null)
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setManualSaving(false)
    }
  }

  /**
   * Merge a presentation patch for one group and persist the overlay.
   * Optimistic: the tree reflects the change immediately and rolls back if the
   * host refuses the write (the dialog has no confirm step).
   */
  const updateCategoryAppearance = async (key: string, patch: CategoryAppearance): Promise<void> => {
    if (manualSaving) return
    setManualSaving(true)
    const previous = manual
    try {
      const merged: CategoryAppearance = { ...(manual.appearance[key] ?? {}), ...patch }
      const appearance = { ...manual.appearance }
      const cleaned = pruneAppearance(merged)
      if (cleaned === undefined) delete appearance[key]
      else appearance[key] = cleaned
      const next: NormalizedManual = { ...manual, appearance }
      setManual(next)
      await saveManualOverlay(next)
      setManualError(null)
    } catch (reason) {
      setManual(previous)
      setManualError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setManualSaving(false)
    }
  }

  /** Pin/unpin a group (pinned groups render above the normal order). */
  const toggleCategoryPinned = async (key: string): Promise<void> => {
    await updateCategoryAppearance(key, { pinned: !isCategoryPinned(manual, key) })
  }

  /** Appearance currently shown in the dialog (empty while it is closed). */
  const appearanceCurrent: CategoryAppearance = appearanceTarget === null
    ? {}
    : (manual.appearance[appearanceTarget] ?? {})

  /**
   * Commit the custom-icon text field. Invalid input is blocked locally (the
   * host would 400 the whole overlay save); an empty field clears the icon.
   */
  const commitAppearanceIcon = (): void => {
    if (appearanceTarget === null) return
    const icon = (appearanceDraft.icon ?? '').trim()
    if (icon !== '' && !ICON_VALUE_PATTERN.test(icon)) {
      setAppearanceError(t('group.iconInvalid'))
      return
    }
    setAppearanceError(null)
    /* Blur fires before a neighbouring click and on every dialog close: skip
       the PUT when the field still matches the stored value. */
    if (icon === (appearanceCurrent.icon ?? '')) return
    void updateCategoryAppearance(appearanceTarget, { icon: icon === '' ? undefined : icon })
  }

  /**
   * Drop on a row. The insertion point is re-derived from the drop event's
   * position (top half = before, bottom half = after), so it always matches
   * the indicator the user last saw — even when dragover and drop arrive in
   * the same tick.
   */
  const onDropRow = (categoryKey: string, row: DropRowRef) => (event: DragEvent): void => {
    event.preventDefault()
    // Keep the drop from bubbling to the enclosing top-level area (which is
    // also a move-out target): a row drop and the area-drop below it must not
    // both fire moveWorkspaceTo.
    event.stopPropagation()
    setDragIndicator(null)
    setDragging(null)
    const draggedCategory = event.dataTransfer.getData(DND_CATEGORY_TYPE)
    if (draggedCategory !== '') {
      // Group reorder: only category rows are targets (project rows fold
      // during group drags); before/after follows the drop position.
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const before = event.clientY < rect.top + rect.height / 2
      const beforeKey = row.kind === 'category' && before ? row.key : undefined
      const afterKey = row.kind === 'category' && !before ? row.key : undefined
      void moveCategory(draggedCategory, beforeKey, afterKey)
      return
    }
    const workspaceId = event.dataTransfer.getData(DND_WORKSPACE_TYPE) || event.dataTransfer.getData('text/plain')
    if (workspaceId === '') return
    if (row.kind === 'topLevel') {
      // Top-level row / top-level blank drop = move OUT of any group (forced
      // top-level, rules ignored) and set the position inside the ordered
      // top-level list. A row drop re-derives before/after from the drop
      // position; a bare area drop (key = UNCATEGORIZED_KEY) appends to the end.
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const before = event.clientY < rect.top + rect.height / 2
      const specificKey = row.key === UNCATEGORIZED_KEY ? undefined : row.key
      void moveWorkspaceTo(workspaceId, UNCATEGORIZED_KEY, before ? specificKey : undefined, !before ? specificKey : undefined)
      return
    }
    // Project move/reorder: a line on a project row = reorder before/after it;
    // dropping anywhere else in a category = move into the group (its end).
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const before = event.clientY < rect.top + rect.height / 2
    const beforeWsid = row.kind === 'workspace' && before ? row.key : undefined
    const afterWsid = row.kind === 'workspace' && !before ? row.key : undefined
    void moveWorkspaceTo(workspaceId, categoryKey, beforeWsid, afterWsid)
  }

  const onDragOverRow = (row: DropRowRef) => (event: DragEvent): void => {
    if (!hasPluginDragType(event.dataTransfer.types)) return
    const draggingCategory = Array.from(event.dataTransfer.types as Iterable<string>).includes(DND_CATEGORY_TYPE)
    if (draggingCategory && row.kind !== 'category') return // group drags target category rows only
    event.preventDefault()
    // Keep a row's dragover from bubbling to the enclosing top-level area
    // (which would interpret it as the end-of-list landing).
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const before = event.clientY < rect.top + rect.height / 2
    if (draggingCategory || row.kind === 'workspace' || row.kind === 'topLevel') {
      // Group reorder (line on a category row), project reorder inside a
      // group (line on a project row), or top-level reorder (line on a
      // top-level project row).
      setDragIndicator(prev =>
        prev?.mode === 'line' && prev.row.kind === row.kind && prev.row.key === row.key && prev.before === before
          ? prev
          : { mode: 'line', row, before })
    } else {
      // Dropping a project INTO a group: whole-row highlight.
      setDragIndicator(prev =>
        prev?.mode === 'into' && prev.categoryKey === row.key ? prev : { mode: 'into', categoryKey: row.key })
    }
  }

  const onDragLeaveRow = (event: DragEvent): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragIndicator(null)
  }

  /**
   * Drag over the TOP-LEVEL AREA's blank space (not on a row ???rows stop
   * propagation). An insertion line shows the landing spot: empty top level —
   * a standalone line under the last group; non-empty — a line below the last
   * top-level row (end of the list).
   */
  const onDragOverTopLevelArea = (event: DragEvent): void => {
    if (!hasPluginDragType(event.dataTransfer.types)) return
    const draggingCategory = Array.from(event.dataTransfer.types as Iterable<string>).includes(DND_CATEGORY_TYPE)
    if (draggingCategory) return // group drags never target the top-level area
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const last = topLevel.length > 0 ? topLevel[topLevel.length - 1] : undefined
    if (last !== undefined) {
      setDragIndicator(prev =>
        prev?.mode === 'line' && prev.row.kind === 'topLevel' && prev.row.key === last.workspaceId && prev.before === false
          ? prev
          : { mode: 'line', row: { kind: 'topLevel', key: last.workspaceId }, before: false })
    } else {
      setDragIndicator(prev =>
        prev?.mode === 'line' && prev.row.kind === 'topLevel' && prev.row.key === topLevelRef.key && prev.before === false
          ? prev
          : { mode: 'line', row: topLevelRef, before: false })
    }
  }

  // While dragging a project, only PROJECT rows fold — every expanded
  // workspace collapses (inside groups AND top-level); group rows keep their
  // expansion so the user still sees where groups are. dragend restores the
  // snapshot taken here.
  const onDragStartWorkspace = (_workspaceId: string) => (): void => {
    setDragging('workspace')
    expansionSnapshot.current = {
      categories: { ...categoryExpansion },
      workspaces: { ...workspaceExpansion },
    }
    for (const key of Object.keys(workspaceExpansion)) {
      if (workspaceExpansion[key]) actions.setWorkspaceExpanded(key, false)
    }
  }

  // While dragging a group, only GROUP rows fold (their rows stay visible as
  // reorder targets); project rows keep their expansion. dragend restores the
  // snapshot taken here.
  const onDragStartCategory = (categoryKey: string) => (event: DragEvent): void => {
    event.dataTransfer.setData(DND_CATEGORY_TYPE, categoryKey)
    event.dataTransfer.effectAllowed = 'move'
    setDragging('category')
    expansionSnapshot.current = {
      categories: { ...categoryExpansion },
      workspaces: { ...workspaceExpansion },
    }
    for (const key of Object.keys(categoryExpansion)) {
      if (categoryExpansion[key]) actions.setCategoryExpanded(key, false)
    }
  }

  const now = Date.now()

  return (
    <div className={`wgRoot${wide ? '' : ' wgRail'}`}>
      {/* The tab strip portals itself into the conversation column's head seat,
          so its position here is irrelevant to where it appears; rendering it
          from this component is what keeps it on this fiber (and therefore on
          this store's single scope) while still reaching the other column. */}
      <SessionTabs
        useSessions={useSessions}
        useSessionStatus={useSessionStatus}
        useWorkspaces={useWorkspaces}
        useTabs={useTabs}
        actions={tabActions}
        activate={activateTab}
        rename={onSessionRename}
        t={t}
      />
      <div className="wgSectionHeader">
        {wide && <span className="wgSectionLabel">{t('section.workspaces')}</span>}
        {wide && (
          <div className={`wgSearch${searchExpanded ? ' wgSearchExpanded' : ''}`} ref={searchRoot}>
            <button
              type="button"
              className="wgIconButton"
              aria-label={t('search')}
              onClick={() => { setSearchExpanded(true) }}
            >
              <IconSearchOutlineRegular size={searchExpanded ? 11 : 14} />
            </button>
            {searchExpanded && (
              <input
                ref={searchInput}
                className="wgSearchInput"
                type="text"
                placeholder={t('search.placeholder')}
                maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
                value={query}
                autoFocus
                onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  setQuery('')
                  setSearchExpanded(false)
                }}
              />
            )}
            {searchExpanded && (
              <button
                type="button"
                className="wgIconButton"
                aria-label={t('search.clear')}
                onClick={(e) => {
                  e.stopPropagation()
                  setQuery('')
                  setSearchExpanded(false)
                }}
              >
                <IconCloseFillMedium />
              </button>
            )}
          </div>
        )}
        <Tooltip label={t('group.create')} side="bottom" delayMs={500}>
          <button
            type="button"
            className="wgIconButton"
            aria-label={t('group.create')}
            onClick={() => {
              setGroupDraft('')
              setGroupError(null)
              setGroupDialog({ mode: 'create' })
            }}
          >
            <IconFolderOpenOutlineRegular size={wide ? 16 : 18} />
          </button>
        </Tooltip>
        <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
          <button
            type="button"
            className="wgIconButton"
            aria-label={t('workspace.add')}
            disabled={adding}
            onClick={addWorkspace}
          >
            <IconProjectAddOutlineRegular size={wide ? 16 : 18} />
          </button>
        </Tooltip>
      </div>

      {!wide && (
        <div className="wgSectionHeader">
          <Tooltip label={t('search')}>
            <button
              type="button"
              className="wgIconButton"
              aria-label={t('search')}
              onClick={() => { setSearchExpanded(true); expandSidebar() }}
            >
              <IconSearchOutlineRegular size={18} />
            </button>
          </Tooltip>
        </div>
      )}

      <div className="wgTreeBody">
        {configError !== null && (
          <div className="wgSearchStatus" role="status">{t('configUnavailable')}</div>
        )}
        {manualError !== null && (
          <div className="wgSearchStatus wgManualError" role="alert">{t('manual.saveError')}: {manualError}</div>
        )}
        {wide && normalizedQuery !== '' ? (
          <SearchBody
            list={list}
            workspaces={workspaces}
            config={config}
            archivedSessionIds={archivedSessionIds}
            statuses={statuses}
            query={normalizedQuery}
            remote={remoteSearch}
            resultLimit={searchResultLimit}
            current={current}
            now={now}
            open={open}
            manual={manual}
            folders={foldersDoc}
            t={t}
          />
        ) : (
          /* The branch overlay lives beside the tree, not inside it: it measures
             the rows and paints behind them, so it must share their box without
             becoming a row itself (which would break role="tree" semantics and
             the index-based measurement). */
          <div className="wgTreeWrap" ref={branchScope}>
            <FlowerBranch scope={branchScope.current} spinning={currentRunning} />
            <div className="wgList" role="tree" aria-label={t('section.workspaces')}>
            {groups.length === 0 && topLevel.length === 0 && !topLevelDropActive && (
              <div className="wgEmpty">{workspacePhase === 'ready' ? t('empty.noWorkspaces') : t('empty.none')}</div>
            )}
            {groups.map((category) => (
              <CategorySection
                key={category.key}
                category={category}
                current={current}
                now={now}
                t={t}
                dragIndicator={dragIndicator}
                onDragOverRow={onDragOverRow}
                onDragLeaveRow={onDragLeaveRow}
                onDropRow={onDropRow}
                onDragStartCategory={onDragStartCategory(category.key)}
                onDragStartWorkspace={onDragStartWorkspace}
                onToggleCategory={() => { actions.setCategoryExpanded(category.key, !category.expanded) }}
                onToggleWorkspace={(key) => { actions.setWorkspaceExpanded(key, !workspaceExpansion[key]) }}
                onNewSession={startSessionAtRoot}
                onOpen={open}
                onToggleFolder={toggleFolder}
                onFolderNewSession={startSessionInFolder}
                onFolderSetRoot={setFolderRoot}
                onFolderRemove={removeFolderFrom}
                onOpenFolderPath={openFolderPath}
                onManageFolders={(workspaceId) => { setFoldersTarget(workspaceId) }}
                creatingFolderKey={creatingSessionIn}
                onRenameRequest={(workspaceId, title) => {
                  setRenameTarget({ workspaceId, currentTitle: title })
                  setRenameDraft(title)
                  setRenameError(null)
                }}
                onDeleteRequest={(workspaceId, title) => {
                  setDeleteTarget({ workspaceId, title })
                  setDeleteError(null)
                }}
                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}
                onFork={forkSession}
                onGroupRename={() => {
                  setGroupDraft(category.key)
                  setGroupError(null)
                  setGroupDialog({ mode: 'rename', from: category.key })
                }}
                onGroupDelete={() => {
                  setGroupDeleteTarget(category.key)
                  setGroupDeleteError(null)
                }}
                onGroupTogglePin={() => { void toggleCategoryPinned(category.key) }}
                onGroupAppearance={() => {
                  setAppearanceDraft(manual.appearance[category.key] ?? {})
                  setAppearanceError(null)
                  setAppearanceTarget(category.key)
                }}
                animate={dragging === null}
                onMoveOut={(workspaceId) => { void moveWorkspaceTo(workspaceId, UNCATEGORIZED_KEY) }}
                onOpenInFolder={openInFolder}
                canMoveOut={(workspaceId) => {
                  // The menu "Move out of group" is offered for any project that
                  // currently sits inside a group (rule-classified or manual) —
                  // not just overridden ones. Top-level projects
                  // (resolveCategory === undefined) don't need it.
                  const workspace = workspaces.find(w => w.workspaceId === workspaceId)
                  return workspace !== undefined
                    && resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title) !== undefined
                }}
              />
            ))}
            {/* Top-level (ungrouped) workspaces, rendered after the group
                folders. While dragging a project the whole area is the
                move-out landing spot (a line shows the insert position;
                an empty top level shows a line under the last group). */}
            {(topLevel.length > 0 || topLevelDropActive) && (
              <TopLevelSection
                topLevel={topLevel}
                current={current}
                now={now}
                t={t}
                dragging={dragging === 'workspace'}
                dragIndicator={dragIndicator}
                topLevelRef={topLevelRef}
                onDragOverRow={onDragOverRow}
                onDragOverTopLevelArea={onDragOverTopLevelArea}
                onDragLeaveRow={onDragLeaveRow}
                onDropRow={onDropRow}
                onDragStartWorkspace={onDragStartWorkspace}
                onToggleWorkspace={(key) => { actions.setWorkspaceExpanded(key, !workspaceExpansion[key]) }}
                onNewSession={startSessionAtRoot}
                onOpen={open}
                onToggleFolder={toggleFolder}
                onFolderNewSession={startSessionInFolder}
                onFolderSetRoot={setFolderRoot}
                onFolderRemove={removeFolderFrom}
                onOpenFolderPath={openFolderPath}
                onManageFolders={(workspaceId) => { setFoldersTarget(workspaceId) }}
                creatingFolderKey={creatingSessionIn}
                onRenameRequest={(workspaceId, title) => {
                  setRenameTarget({ workspaceId, currentTitle: title })
                  setRenameDraft(title)
                  setRenameError(null)
                }}
                onDeleteRequest={(workspaceId, title) => {
                  setDeleteTarget({ workspaceId, title })
                  setDeleteError(null)
                }}
                onSessionRename={onSessionRename}
                onSessionArchive={onSessionArchive}
                onFork={forkSession}
                onOpenInFolder={openInFolder}
              />
            )}
            </div>
          </div>
        )}
      </div>

      {/* Group create / rename dialog */}
      <Modal
        open={groupDialog !== null}
        onClose={() => { setGroupDialog(null) }}
        closeLabel={t('close')}
        title={groupDialog?.mode === 'rename' ? t('group.renameTitle') : t('group.createTitle')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setGroupDialog(null) }}>{t('group.createCancel')}</Button>
            <Button variant="primary" disabled={groupBlocked} onClick={confirmGroupDialog}>
              {groupDialog?.mode === 'rename' ? t('group.renameConfirm') : t('group.createConfirm')}
            </Button>
          </>
        )}
      >
        <input
          className="wgRenameInput"
          value={groupDraft}
          aria-label={t('group.createPlaceholder')}
          placeholder={t('group.createPlaceholder')}
          autoFocus
          onChange={(e) => { setGroupDraft(e.target.value); setGroupError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmGroupDialog() }}
        />
        {groupNameIssue !== null && <div className="wgAddError" role="alert">{groupNameIssue}</div>}
        {groupError !== null && <div className="wgAddError" role="alert">{groupError}</div>}
      </Modal>

      {/* Group delete dialog */}
      <Modal
        open={groupDeleteTarget !== null}
        onClose={() => { setGroupDeleteTarget(null) }}
        closeLabel={t('close')}
        title={t('group.deleteTitle')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setGroupDeleteTarget(null) }}>{t('group.deleteCancel')}</Button>
            <Button variant="outline" disabled={groupDeleting} onClick={confirmGroupDelete}>{t('group.delete')}</Button>
          </>
        )}
      >
        <div className="wgAddError">{t('group.deleteConfirm')}</div>
        {groupDeleteError !== null && <div className="wgAddError" role="alert">{groupDeleteError}</div>}
      </Modal>

      {/* Group appearance dialog: every control writes immediately (optimistic
          patch + rollback banner), so the footer is only "done". */}
      <Modal
        open={appearanceTarget !== null}
        onClose={() => { setAppearanceTarget(null) }}
        closeLabel={t('group.appearanceDone')}
        title={t('group.appearanceTitle')}
        footer={(
          <Button variant="primary" onClick={() => { setAppearanceTarget(null) }}>{t('group.appearanceDone')}</Button>
        )}
      >
        {appearanceTarget !== null && (
          <>
            <div className="wgAppearanceSection">
              <div className="wgAppearanceLabel">{t('group.color')}</div>
              <div className="wgSwatchRow" role="group" aria-label={t('group.color')}>
                <button
                  type="button"
                  className={`wgSwatch wgSwatchDefault${appearanceCurrent.color === undefined ? ' wgSwatchActive' : ''}`}
                  aria-pressed={appearanceCurrent.color === undefined}
                  aria-label={t('group.colorDefault')}
                  title={t('group.colorDefault')}
                  disabled={manualSaving}
                  onClick={() => { void updateCategoryAppearance(appearanceTarget, { color: undefined }) }}
                />
                {GROUP_COLORS.map((color) => {
                  const active = appearanceCurrent.color === color
                  return (
                    <button
                      key={color}
                      type="button"
                      className={`wgSwatch${active ? ' wgSwatchActive' : ''}`}
                      data-wg-color={color}
                      aria-pressed={active}
                      aria-label={t(COLOR_LABEL_KEYS[color])}
                      title={t(COLOR_LABEL_KEYS[color])}
                      disabled={manualSaving}
                      onClick={() => { void updateCategoryAppearance(appearanceTarget, { color }) }}
                    />
                  )
                })}
              </div>
            </div>
            <div className="wgAppearanceSection">
              <div className="wgAppearanceLabel">{t('group.icon')}</div>
              <div className="wgIconGrid" role="group" aria-label={t('group.icon')}>
                {GROUP_ICON_IDS.map((id) => {
                  const active = appearanceCurrent.icon === id
                  return (
                    <button
                      key={id}
                      type="button"
                      className="wgIconCell"
                      aria-pressed={active}
                      aria-label={id}
                      title={id}
                      disabled={manualSaving}
                      onClick={() => {
                        setAppearanceDraft({ ...appearanceDraft, icon: id })
                        setAppearanceError(null)
                        void updateCategoryAppearance(appearanceTarget, { icon: id })
                      }}
                    >
                      <CategoryGlyph icon={id} />
                    </button>
                  )
                })}
              </div>
              <input
                className="wgRenameInput"
                value={appearanceDraft.icon ?? ''}
                aria-label={t('group.iconCustom')}
                placeholder={t('group.iconDefault')}
                disabled={manualSaving}
                onChange={(e) => {
                  setAppearanceDraft({ ...appearanceDraft, icon: e.target.value })
                  setAppearanceError(null)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') commitAppearanceIcon() }}
                onBlur={(event) => {
                  /* A swatch / preset click moves focus out of the field in the
                     same gesture and writes its own patch — committing the stale
                     draft here would race it and could overwrite the preset. */
                  const next = event.relatedTarget
                  if (next instanceof Element && next.closest('.wgSwatch, .wgIconCell') !== null) return
                  commitAppearanceIcon()
                }}
              />
            </div>
            <div className="wgAppearanceSection">
              <Button
                variant={appearanceCurrent.pinned === true ? 'primary' : 'outline'}
                disabled={manualSaving}
                onClick={() => { void updateCategoryAppearance(appearanceTarget, { pinned: appearanceCurrent.pinned !== true }) }}
              >
                {appearanceCurrent.pinned === true ? t('group.unpin') : t('group.pin')}
              </Button>
            </div>
            {appearanceError !== null && <div className="wgAddError" role="alert">{appearanceError}</div>}
          </>
        )}
      </Modal>

      {/* Per-workspace folders dialog: base + extra folders, root radio,
          open/remove per row. Mounted only while a project row asked for it. */}
      {foldersTarget !== null && (() => {
        const workspace = workspaces.find(w => w.workspaceId === foldersTarget)
        if (workspace === undefined) return null
        return (
          <FoldersDialog
            workspace={workspace}
            entry={entryFor(foldersDoc, foldersTarget as string)}
            t={t}
            busy={foldersBusy}
            canOpen={openFolderPath !== undefined}
            remote={isRemoteWorkspace(workspace)}
            onClose={() => { setFoldersTarget(null) }}
            onAdd={() => { void addFolderTo(foldersTarget) }}
            onAddSubpath={(relative) => { addSubpathTo(foldersTarget, relative) }}
            onSetRoot={(path) => { setFolderRoot(foldersTarget, path) }}
            onRemove={(path) => { removeFolderFrom(foldersTarget, path) }}
            onOpenFolder={(path) => { openFolderPath?.(path) }}
          />
        )
      })()}

      {/* Workspace rename dialog */}
      <Modal
        open={renameTarget !== null}
        onClose={() => { setRenameTarget(null) }}
        closeLabel={t('close')}
        title={t('workspace.renameTitle')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRenameTarget(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={renameBlocked} onClick={confirmRename}>{t('workspace.renameConfirm')}</Button>
          </>
        )}
      >
        <input
          className="wgRenameInput"
          value={renameDraft}
          aria-label={t("workspace.renamePlaceholder")}
          autoFocus
          onChange={(e) => { setRenameDraft(e.target.value) }}
          onKeyDown={(e) => { if (e.key === "Enter") confirmRename() }}
        />
        {renameError !== null && <div className="wgAddError" role="alert">{renameError}</div>}
      </Modal>

      {/* Workspace delete dialog */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null) }}
        closeLabel={t('close')}
        title={t('workspace.deleteTitle')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setDeleteTarget(null) }}>{t('workspace.deleteCancel')}</Button>
            <Button variant="outline" disabled={deleting} onClick={confirmDelete}>{t('workspace.delete')}</Button>
          </>
        )}
      >
        <div className="wgAddError">{t('workspace.deleteConfirm')}</div>
        {deleteError !== null && <div className="wgAddError" role="alert">{deleteError}</div>}
      </Modal>

      {/* Session rename dialog */}
      <Modal
        open={sessionRenameTarget !== null}
        onClose={() => { setSessionRenameTarget(null) }}
        closeLabel={t('close')}
        title={t('session.renameTitle')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setSessionRenameTarget(null) }}>{t('session.renameCancel')}</Button>
            <Button variant="primary" disabled={sessionRenameBlocked} onClick={confirmSessionRename}>{t('session.renameConfirm')}</Button>
          </>
        )}
      >
        <input
          className="wgRenameInput"
          value={sessionRenameDraft}
          aria-label={t("session.renamePlaceholder")}
          autoFocus
          onChange={(e) => { setSessionRenameDraft(e.target.value) }}
          onKeyDown={(e) => { if (e.key === "Enter") confirmSessionRename() }}
        />
        {sessionRenameError !== null && <div className="wgAddError" role="alert">{sessionRenameError}</div>}
      </Modal>

      {/* Add workspace error dialog */}
      <Modal
        open={addErrorOpen}
        onClose={() => { setAddErrorOpen(false) }}
        closeLabel={t('close')}
        title={t('workspace.addErrorTitle')}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setAddErrorOpen(false) }}>{t('close')}</Button>
            <Button variant="primary" onClick={addWorkspace}>{t('retry')}</Button>
          </>
        )}
      >
        <div className="wgAddError" role="alert">{addError}</div>
      </Modal>

      {/* "Open in folder" failure: transient banner, keyed per attempt so a
          repeat failure restarts the cycle. */}
      {folderError !== null && (
        <Toast
          key={folderError.id}
          text={folderError.text}
          icon={<IconWarningOutlineRegular size={16} />}
          onDone={() => { setFolderError(null) }}
        />
      )}

      {/* Ctrl+R quick switch panel (conditionally mounted: fresh query per open). */}
      {quickOpen && (
        <QuickPanel
          onClose={() => { setQuickOpen(false) }}
          list={list}
          workspaces={workspaces}
          archivedSessionIds={archivedSessionIds}
          categoryByWorkspace={categoryByWorkspace}
          current={current}
          startSession={startSession}
          openSession={open}
          now={now}
          t={t}
        />
      )}
    </div>
  )
}

/** Resolve the category label containing the current session (auto-expand helper). */
function categoriesForCurrent(
  config: GroupsConfig,
  workspaces: readonly WorkspaceView[],
  current: SessionId,
  manual: ManualGroups,
): string | undefined {
  const workspace = workspaces.find(w => w.sessionIds.includes(current))
  if (workspace === undefined) return undefined
  return resolveCategory(config, manual, workspace.workspaceId, workspace.path, workspace.title)
}

/**
 * The expanded session rows of one project. Workspaces with extra folders get
 * one folder row per folder (root first) and hang their sessions off that
 * folder; a workspace without extra folders renders today's flat list, so the
 * common case is unchanged row-for-row.
 */
function WorkspaceSubtree({ workspace, current, now, t, animate, onOpen, onSessionRename, onSessionArchive, onFork, onToggleFolder, onFolderNewSession, onFolderSetRoot, onFolderRemove, onOpenFolderPath, creatingFolderKey }: {
  workspace: WorkspaceGroupNode
  current: SessionId | undefined
  now: number
  t: GroupsBrowserProps['t']
  animate: boolean
  onOpen: (sessionId: SessionId) => void
  onSessionRename: (sessionId: SessionId, currentTitle: string) => void
  onSessionArchive: (sessionId: SessionId) => void
  onFork: (sessionId: SessionId) => void
  onToggleFolder: (workspaceId: WorkspaceId, path: string) => void
  onFolderNewSession: (workspaceId: WorkspaceId, path: string, isBase: boolean) => void
  onFolderSetRoot: (workspaceId: WorkspaceId, path: string) => void
  onFolderRemove: (workspaceId: WorkspaceId, path: string) => void
  onOpenFolderPath?: ((path: string) => void) | undefined
  creatingFolderKey: string | null
}) {
  const folders = workspace.folders
  if (folders === undefined) {
    return (
      <RowGroup
        expanded={workspace.expanded}
        className="wgTreeChildren"
        animate={animate && workspace.sessions.length <= ANIMATION_ROW_CAP}
      >
        {workspace.sessions.map((session) => (
          <SessionRow
            key={session.id}
            node={session}
            currentId={current}
            now={now}
            t={t}
            onOpen={onOpen}
            onRename={onSessionRename}
            onFork={onFork}
            onArchive={onSessionArchive}
          />
        ))}
      </RowGroup>
    )
  }
  return (
    <RowGroup
      expanded={workspace.expanded}
      className="wgTreeChildren"
      animate={animate && folders.length + workspace.sessions.length <= ANIMATION_ROW_CAP}
    >
      {folders.map((folder) => {
        const key = folderKey(workspace.workspaceId, folder.path)
        return (
          <div key={key} role="group">
            <FolderRow
              node={folder}
              t={t}
              creating={creatingFolderKey === key}
              onToggle={() => { onToggleFolder(workspace.workspaceId, folder.path) }}
              onNewSession={() => { onFolderNewSession(workspace.workspaceId, folder.path, folder.isBase) }}
              onSetRoot={() => { onFolderSetRoot(workspace.workspaceId, folder.path) }}
              onRemove={() => { onFolderRemove(workspace.workspaceId, folder.path) }}
              {...(onOpenFolderPath !== undefined
                ? { onOpenInFolder: () => { onOpenFolderPath(folder.path) } }
                : {})}
            />
            <RowGroup
              expanded={folder.expanded}
              className="wgTreeChildren"
              animate={animate && folder.sessions.length <= ANIMATION_ROW_CAP}
            >
              {folder.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  node={session}
                  nested
                  currentId={current}
                  now={now}
                  t={t}
                  onOpen={onOpen}
                  onRename={onSessionRename}
                  onFork={onFork}
                  onArchive={onSessionArchive}
                />
              ))}
            </RowGroup>
          </div>
        )
      })}
    </RowGroup>
  )
}

/** One category section: header row + expanded workspace folders. */
function CategorySection({ category, current, now, t, dragIndicator, onDragOverRow, onDragLeaveRow, onDropRow, onDragStartCategory, onDragStartWorkspace, onToggleCategory, onToggleWorkspace, onNewSession, onOpen, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, onFork, onGroupRename, onGroupDelete, onGroupTogglePin, onGroupAppearance, animate, onMoveOut, canMoveOut, onOpenInFolder, onToggleFolder, onFolderNewSession, onFolderSetRoot, onFolderRemove, onOpenFolderPath, onManageFolders, creatingFolderKey }: {
  category: CategoryNode
  current: SessionId | undefined
  now: number
  t: GroupsBrowserProps['t']
  dragIndicator: DragIndicator
  /** Whether the disclosure animation may play (false while a drag folds rows). */
  animate: boolean
  onDragOverRow: (row: DropRowRef) => (event: DragEvent) => void
  onDragLeaveRow: (event: DragEvent) => void
  /** Drop factory: bind the target category and the row kind (before/after re-derived at drop time). */
  onDropRow: (categoryKey: string, row: DropRowRef) => (event: DragEvent) => void
  onDragStartCategory: (event: DragEvent) => void
  onDragStartWorkspace: (workspaceId: WorkspaceId) => () => void
  onToggleCategory: () => void
  onToggleWorkspace: (key: string) => void
  onNewSession: (workspaceId?: WorkspaceId) => void
  onOpen: (sessionId: SessionId) => void
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  onDeleteRequest: (workspaceId: WorkspaceId, title: string) => void
  onSessionRename: (sessionId: SessionId, currentTitle: string) => void
  onSessionArchive: (sessionId: SessionId) => void
  onFork: (sessionId: SessionId) => void
  onGroupRename: () => void
  onGroupDelete: () => void
  /** Pin/unpin this group from its row menu. */
  onGroupTogglePin: () => void
  /** Open the appearance dialog for this group. */
  onGroupAppearance: () => void
  onMoveOut: (workspaceId: WorkspaceId) => void
  canMoveOut: (workspaceId: WorkspaceId) => boolean
  onToggleFolder: (workspaceId: WorkspaceId, path: string) => void
  onFolderNewSession: (workspaceId: WorkspaceId, path: string, isBase: boolean) => void
  onFolderSetRoot: (workspaceId: WorkspaceId, path: string) => void
  onFolderRemove: (workspaceId: WorkspaceId, path: string) => void
  onManageFolders: (workspaceId: WorkspaceId) => void
  /** Creation in flight, keyed by `folderKey`; disables the row's controls */
  creatingFolderKey: string | null
  /** Absent when the host resolved no folder application. */
  onOpenInFolder?: ((workspaceId: WorkspaceId) => void) | undefined
  /** Absent when the host resolved no folder application. */
  onOpenFolderPath?: ((path: string) => void) | undefined
}) {
  const categoryLine = dragIndicator?.mode === 'line' && dragIndicator.row.kind === 'category' && dragIndicator.row.key === category.key
    ? (dragIndicator.before ? 'before' : 'after')
    : undefined
  const categoryInto = dragIndicator?.mode === 'into' && dragIndicator.categoryKey === category.key
  return (
    <div role="group">
      <CategoryRow
        node={category}
        t={t}
        onToggle={onToggleCategory}
        onRename={onGroupRename}
        onDelete={onGroupDelete}
        onTogglePin={onGroupTogglePin}
        onEditAppearance={onGroupAppearance}
        onDragStartCategory={onDragStartCategory}
        dropActive={categoryInto}
        {...(categoryLine !== undefined ? { insertLine: categoryLine } : {})}
        onRowDragOver={onDragOverRow({ kind: 'category', key: category.key })}
        onRowDragLeave={onDragLeaveRow}
        onRowDrop={onDropRow(category.key, { kind: 'category', key: category.key })}
      />
      <RowGroup
        expanded={category.expanded}
        className="wgCategoryChildren"
        animate={animate && categoryRowCount(category) <= ANIMATION_ROW_CAP}
      >
        {category.workspaces.map((workspace) => (
          <div key={workspace.workspaceId} role="group">
            <WorkspaceRow
              node={workspace}
              t={t}
              onToggle={() => { onToggleWorkspace(workspace.workspaceId as string) }}
              onNewSession={() => { onNewSession(workspace.workspaceId) }}
              onRename={() => { onRenameRequest(workspace.workspaceId, workspace.label) }}
              onDelete={() => { onDeleteRequest(workspace.workspaceId, workspace.label) }}
              canMoveOut={canMoveOut(workspace.workspaceId)}
              onMoveOut={() => { onMoveOut(workspace.workspaceId) }}
              {...(onOpenInFolder !== undefined
                ? { onOpenInFolder: () => { onOpenInFolder(workspace.workspaceId) } }
                : {})}
              dropActive={false}
              {...(dragIndicator?.mode === 'line' && dragIndicator.row.kind === 'workspace' && dragIndicator.row.key === workspace.workspaceId
                ? { insertLine: dragIndicator.before ? 'before' : 'after' }
                : {})}
              onRowDragOver={onDragOverRow({ kind: 'workspace', key: workspace.workspaceId })}
              onRowDragLeave={onDragLeaveRow}
              onRowDrop={onDropRow(category.key, { kind: 'workspace', key: workspace.workspaceId })}
              onDragStartExtra={onDragStartWorkspace(workspace.workspaceId)}
              onManageFolders={() => { onManageFolders(workspace.workspaceId) }}
            />
            <WorkspaceSubtree
              workspace={workspace}
              current={current}
              now={now}
              t={t}
              animate={animate}
              onOpen={onOpen}
              onSessionRename={onSessionRename}
              onSessionArchive={onSessionArchive}
              onFork={onFork}
              onToggleFolder={onToggleFolder}
              onFolderNewSession={onFolderNewSession}
              onFolderSetRoot={onFolderSetRoot}
              onFolderRemove={onFolderRemove}
              onOpenFolderPath={onOpenFolderPath}
              creatingFolderKey={creatingFolderKey}
            />
          </div>
        ))}
      </RowGroup>
    </div>
  )
}

/**
 * Top-level (ungrouped) workspace rows rendered after the group folders. While
 * a project drag is in progress the WHOLE top-level area is the move-out
 * landing spot, shown with an insertion LINE (not a highlight box):
 * - a top-level row reorders before/after it (line above/below, like a group);
 * - the blank space below the last row appends to the end (line below the
 *   last row);
 * - an empty top level shows a standalone line under the last group folder.
 */
function TopLevelSection({ topLevel, current, now, t, dragging, dragIndicator, topLevelRef, onDragOverRow, onDragOverTopLevelArea, onDragLeaveRow, onDropRow, onDragStartWorkspace, onToggleWorkspace, onNewSession, onOpen, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, onFork, onOpenInFolder, onToggleFolder, onFolderNewSession, onFolderSetRoot, onFolderRemove, onOpenFolderPath, onManageFolders, creatingFolderKey }: {
  topLevel: readonly WorkspaceGroupNode[]
  current: SessionId | undefined
  now: number
  t: GroupsBrowserProps['t']
  /** A project drag is in progress (drives the empty-top-level landing line). */
  dragging: boolean
  dragIndicator: DragIndicator
  topLevelRef: DropRowRef
  onDragOverRow: (row: DropRowRef) => (event: DragEvent) => void
  onDragOverTopLevelArea: (event: DragEvent) => void
  onDragLeaveRow: (event: DragEvent) => void
  onDropRow: (categoryKey: string, row: DropRowRef) => (event: DragEvent) => void
  onDragStartWorkspace: (workspaceId: WorkspaceId) => () => void
  onToggleWorkspace: (key: string) => void
  onNewSession: (workspaceId?: WorkspaceId) => void
  onOpen: (sessionId: SessionId) => void
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  onDeleteRequest: (workspaceId: WorkspaceId, title: string) => void
  onSessionRename: (sessionId: SessionId, currentTitle: string) => void
  onSessionArchive: (sessionId: SessionId) => void
  onFork: (sessionId: SessionId) => void
  onToggleFolder: (workspaceId: WorkspaceId, path: string) => void
  onFolderNewSession: (workspaceId: WorkspaceId, path: string, isBase: boolean) => void
  onFolderSetRoot: (workspaceId: WorkspaceId, path: string) => void
  onFolderRemove: (workspaceId: WorkspaceId, path: string) => void
  onManageFolders: (workspaceId: WorkspaceId) => void
  creatingFolderKey: string | null
  /** Absent when the host resolved no folder application. */
  onOpenInFolder?: ((workspaceId: WorkspaceId) => void) | undefined
  /** Absent when the host resolved no folder application. */
  onOpenFolderPath?: ((path: string) => void) | undefined
}) {
  const emptyLineActive = dragIndicator?.mode === 'line' && dragIndicator.row.kind === 'topLevel' && dragIndicator.row.key === topLevelRef.key
  return (
    <div
      role="group"
      aria-label={t('section.topLevel')}
      className="wgTopLevelArea"
      onDragOver={onDragOverTopLevelArea}
      onDragLeave={onDragLeaveRow}
      onDrop={onDropRow(UNCATEGORIZED_KEY, topLevelRef)}
    >
      {topLevel.length === 0 && dragging && (
        <div
          className={`wgTopLevelEmpty${emptyLineActive ? ' wgTopLevelEmptyActive' : ''}`}
          role="treeitem"
          onDragOver={onDragOverRow(topLevelRef)}
          onDragLeave={onDragLeaveRow}
          onDrop={onDropRow(UNCATEGORIZED_KEY, topLevelRef)}
        >
          <span className="wgTopLevelEmptyLine" />
        </div>
      )}
      {topLevel.map((workspace) => (
        <div key={workspace.workspaceId} role="group">
          <WorkspaceRow
            node={workspace}
            t={t}
            flat
            onToggle={() => { onToggleWorkspace(workspace.workspaceId as string) }}
            onNewSession={() => { onNewSession(workspace.workspaceId) }}
            onRename={() => { onRenameRequest(workspace.workspaceId, workspace.label) }}
            onDelete={() => { onDeleteRequest(workspace.workspaceId, workspace.label) }}
            {...(onOpenInFolder !== undefined
              ? { onOpenInFolder: () => { onOpenInFolder(workspace.workspaceId) } }
              : {})}
            {...(dragIndicator?.mode === 'line' && dragIndicator.row.kind === 'topLevel' && dragIndicator.row.key === workspace.workspaceId
              ? { insertLine: dragIndicator.before ? 'before' : 'after' }
              : {})}
            onRowDragOver={onDragOverRow({ kind: 'topLevel', key: workspace.workspaceId })}
            onRowDragLeave={onDragLeaveRow}
            onRowDrop={onDropRow(UNCATEGORIZED_KEY, { kind: 'topLevel', key: workspace.workspaceId })}
            onDragStartExtra={onDragStartWorkspace(workspace.workspaceId)}
            onManageFolders={() => { onManageFolders(workspace.workspaceId) }}
          />
          <WorkspaceSubtree
            workspace={workspace}
            current={current}
            now={now}
            t={t}
            animate={!dragging}
            onOpen={onOpen}
            onSessionRename={onSessionRename}
            onSessionArchive={onSessionArchive}
            onFork={onFork}
            onToggleFolder={onToggleFolder}
            onFolderNewSession={onFolderNewSession}
            onFolderSetRoot={onFolderSetRoot}
            onFolderRemove={onFolderRemove}
            onOpenFolderPath={onOpenFolderPath}
            creatingFolderKey={creatingFolderKey}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Search hits inside one project. When the project owns extra folders the hits
 * keep their folder row (all expanded, since search prunes to matches) so a
 * match never loses the folder it came from.
 */
function SearchSubtree({ workspace, current, now, open, t }: {
  workspace: WorkspaceGroupNode
  current: SessionId | undefined
  now: number
  open: (sessionId: SessionId) => void
  t: GroupsBrowserProps['t']
}) {
  const folders = workspace.folders
  if (folders === undefined) {
    return (
      <div role="group">
        {workspace.sessions.map((session) => (
          <SessionRow
            key={session.id}
            node={session}
            currentId={current}
            now={now}
            t={t}
            onOpen={open}
            onRename={() => {}}
            onFork={() => {}}
            onArchive={() => {}}
          />
        ))}
      </div>
    )
  }
  return (
    <div role="group">
      {folders.map((folder) => (
        <div key={folderKey(workspace.workspaceId, folder.path)} role="group">
          <FolderRow
            node={folder}
            t={t}
            onToggle={() => {}}
            onNewSession={() => {}}
            onSetRoot={() => {}}
            onRemove={() => {}}
          />
          <div role="group">
            {folder.sessions.map((session) => (
              <SessionRow
                key={session.id}
                node={session}
                nested
                currentId={current}
                now={now}
                t={t}
                onOpen={open}
                onRename={() => {}}
                onFork={() => {}}
                onArchive={() => {}}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Search body rendered as a three-level tree pruned to matched branches:
 * Only branches that contain a hit are rendered, which keeps a long list short. Reuses the same row components as
 * the idle tree, so search keeps the same folder hierarchy the user is used to.
 */
function SearchBody({ list, workspaces, config, archivedSessionIds, statuses, query, remote, resultLimit, current, now, open, manual, folders, t }: {
  list: SessionListState
  workspaces: readonly WorkspaceView[]
  config: GroupsConfig
  archivedSessionIds: readonly SessionId[]
  statuses: SessionStatusSnapshot
  query: string
  remote: RemoteSearchState
  resultLimit: number
  current: SessionId | undefined
  now: number
  open: (sessionId: SessionId) => void
  manual: ManualGroups
  folders: FoldersDocument
  t: GroupsBrowserProps['t']
}) {
  const currentRemote = remote.query === query ? remote : { query, status: 'loading' as const, items: [], hasMore: false }
  const matches = useMemo(
    () => deriveSearchMatches(list, workspaces, config, query, archivedSessionIds, currentRemote, resultLimit),
    [list, workspaces, config, query, archivedSessionIds, currentRemote, resultLimit],
  )
  const searchTree = useMemo(
    () => deriveSearchGroups(list, workspaces, config, matches.matchedIds, archivedSessionIds, manual, matches.snippetsBySession, statuses, folders),
    [list, workspaces, config, matches, archivedSessionIds, manual, statuses, folders],
  )
  const groups = searchTree.categories
  const searchTopLevel = searchTree.topLevel
  const pending = currentRemote.status === 'loading'
  const failed = currentRemote.status === 'error'
  return (
    <div className="wgList" role="tree" aria-label={t('search.results.aria')}>
      {groups.map((category) => (
        <div key={category.key} role="group">
          <CategoryRow node={category} t={t} onToggle={() => {}} />
          <div role="group">
            {category.workspaces.map((workspace) => (
              <div key={workspace.workspaceId} role="group">
                <WorkspaceRow
                  node={workspace}
                  t={t}
                  onToggle={() => {}}
                  onNewSession={() => {}}
                  onRename={() => {}}
                  onDelete={() => {}}
                />
                <SearchSubtree workspace={workspace} current={current} now={now} open={open} t={t} />
              </div>
            ))}
          </div>
        </div>
      ))}
      {searchTopLevel.map((workspace) => (
        <div key={workspace.workspaceId} role="group">
          <WorkspaceRow
            node={workspace}
            t={t}
            flat
            onToggle={() => {}}
            onNewSession={() => {}}
            onRename={() => {}}
            onDelete={() => {}}
          />
          <SearchSubtree workspace={workspace} current={current} now={now} open={open} t={t} />
        </div>
      ))}
      {pending && <div className="wgSearchStatus" role="status">{t('search.pending')}</div>}
      {failed && <div className="wgSearchStatus" role="status">{t('search.unavailable')}</div>}
      {!pending && groups.length === 0 && searchTopLevel.length === 0 && (
        <div className="wgEmpty">{t('search.noMatches')}</div>
      )}
      {matches.hasMore && (
        <div className="wgSearchStatus">{t('search.hasMore')}</div>
      )}
    </div>
  )
}

/**
 * Folder list dialog for one workspace: the base folder first, then every extra
 * folder in stored order. The radio column chooses the root (the folder new
 * sessions default to); open/remove act per row, and removing the base folder is
 * never offered because the workspace's canonical directory cannot be dropped.
 */
function FoldersDialog({ workspace, entry, t, busy, canOpen, remote, onClose, onAdd, onAddSubpath, onSetRoot, onRemove, onOpenFolder }: {
  workspace: WorkspaceView
  entry: WorkspaceFolderEntry | undefined
  t: GroupsBrowserProps['t']
  busy: boolean
  canOpen: boolean
  /** Remote (mirror-backed) workspace: extra folders are typed subpaths, not picked. */
  remote: boolean
  onClose: () => void
  onAdd: () => void
  onAddSubpath: (relative: string) => void
  onSetRoot: (path: string) => void
  onRemove: (path: string) => void
  onOpenFolder: (path: string) => void
}) {
  const folders = effectiveFolders(workspace.path, entry)
  const root = rootOf(workspace.path, entry)
  const [subpath, setSubpath] = useState('')
  const submitSubpath = (): void => {
    if (subpath.trim() === '') return
    onAddSubpath(subpath)
    setSubpath('')
  }
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t('folder.title')}
      footer={(
        <Button variant="primary" onClick={onClose}>{t('folder.done')}</Button>
      )}
    >
      <div className="wgFolderList" role="list" aria-label={t('folder.listAria')}>
        {folders.map((path, index) => {
          const isBase = index === 0
          const isRoot = samePath(path, root)
          const label = folderLabel(path)
          return (
            <div key={path} className="wgFolderListRow" role="listitem">
              <input
                type="radio"
                className="wgFolderRadio"
                name="wg-folder-root"
                checked={isRoot}
                aria-label={`${t('folder.rootBadge')} ${label}`}
                onChange={() => { onSetRoot(path) }}
              />
              <span className="wgFolderListLabel" title={path}>{label}</span>
              {isBase && <span className="wgFolderListTag">{t('folder.base')}</span>}
              {isRoot && <span className="wgFolderListTag">{t('folder.rootBadge')}</span>}
              <span className="wgFolderListActions">
                {canOpen && (
                  <button
                    type="button"
                    className="wgIconButton"
                    aria-label={`${t('workspace.openInFolder')} ${label}`}
                    onClick={() => { onOpenFolder(path) }}
                  >
                    <IconFolderOpenOutlineRegular size={16} />
                  </button>
                )}
                {!isBase && (
                  <button
                    type="button"
                    className="wgIconButton"
                    aria-label={`${t('folder.remove')} ${label}`}
                    onClick={() => { onRemove(path) }}
                  >
                    <IconTrashOutlineRegular />
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <div className="wgFolderListFooter">
        {remote
          ? (
            <>
              <p className="wgFolderHint">{t('folder.remoteHint')}</p>
              <div className="wgFolderSubpath">
                <input
                  type="text"
                  className="wgFolderSubpathInput"
                  value={subpath}
                  placeholder={t('folder.subpathPlaceholder')}
                  aria-label={t('folder.subpathLabel')}
                  disabled={busy}
                  onChange={event => setSubpath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    submitSubpath()
                  }}
                />
                <Button variant="outline" disabled={busy || subpath.trim() === ''} onClick={submitSubpath}>
                  {t('folder.addSubpath')}
                </Button>
              </div>
            </>
          )
          : <Button variant="outline" disabled={busy} onClick={onAdd}>{t('folder.add')}</Button>}
      </div>
    </Modal>
  )
}

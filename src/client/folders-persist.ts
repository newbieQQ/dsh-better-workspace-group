/**
 * Client side of the per-workspace folder list, talking to
 * `GET|PUT /workspace-groups/folders` on the host.
 *
 * The document is the host's JSON sidecar verbatim (`version` + `workspaces`),
 * so the client and the host agree on one shape: `folders` holds EXTRA folders
 * only — the workspace's canonical directory is implicit folder #0 — and
 * `root` names one of those extras (absent means "the workspace itself").
 *
 * Reads are best-effort, like the manual overlay and the tab strip: a failed
 * read means "no extra folders". A failed write, however, rejects so the caller
 * can say so — a folder row that silently forgot its edit would be worse than
 * the toast.
 */
import {
  EMPTY_FOLDERS_DOCUMENT,
  type FolderMember,
  type FoldersDocument,
  type WorkspaceFolderEntry,
} from '../core/folders.ts'

/** Host route holding the folder overlay. */
export const FOLDERS_ROUTE = '/workspace-groups/folders'

/** One successful read: the overlay plus the mirror base the host reported. */
export interface FoldersSnapshot {
  readonly document: FoldersDocument
  /**
   * Local mirror root of the remote-ssh plugin, when the host named one.
   * Workspaces whose directory lives below it are remote mirrors, so their extra
   * folders must be subdirectories of that same mirror.
   */
  readonly remoteBase?: string
}

/** One non-empty string field, or undefined when it is absent or blank. */
function wireText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read one member (a folder backed by its own workspace) off the wire.
 * @param value - one value of the stored `members` list.
 * @returns the member, or null for a malformed one.
 */
function parseWireMember(value: unknown): FolderMember | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const path = wireText(row.path)
  const workspaceId = wireText(row.workspaceId)
  // A member without a directory or without its workspace cannot run a session,
  // so it is not worth a row.
  if (path === undefined || workspaceId === undefined) return null
  const remotePath = wireText(row.remotePath)
  const profileId = wireText(row.profileId)
  const recordId = wireText(row.recordId)
  const title = wireText(row.title)
  return {
    path,
    workspaceId,
    kind: row.kind === 'remote' ? 'remote' : 'local',
    ...(remotePath === undefined ? {} : { remotePath }),
    ...(profileId === undefined ? {} : { profileId }),
    ...(recordId === undefined ? {} : { recordId }),
    ...(title === undefined ? {} : { title }),
  }
}

/**
 * Read one workspace entry off the wire, dropping the entry when it is
 * unusable.
 *
 * `members` must survive this round trip: the client owns the whole document
 * (the PUT sends it back verbatim), so an entry parsed without its members is
 * not merely a display gap — the next folder edit would rewrite the sidecar and
 * erase every member-backed folder for good.
 * @param value - one value of the stored `workspaces` mapping.
 * @returns the entry, or null for a malformed one.
 */
function parseWireEntry(value: unknown): WorkspaceFolderEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const folders: string[] = []
  if (Array.isArray(row.folders)) {
    for (const candidate of row.folders) {
      const path = wireText(candidate)
      if (path !== undefined) folders.push(path)
    }
  }
  const members: FolderMember[] = []
  if (Array.isArray(row.members)) {
    for (const candidate of row.members) {
      const member = parseWireMember(candidate)
      if (member !== null) members.push(member)
    }
  }
  if (folders.length === 0 && members.length === 0) return null
  const root = wireText(row.root)
  return {
    folders,
    ...(members.length === 0 ? {} : { members }),
    ...(root === undefined ? {} : { root }),
  }
}

/**
 * Fetch the stored folder overlay.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns the overlay plus the reported mirror base; the empty document on any
 * failure.
 */
export async function loadFolders(fetchImpl: typeof fetch = fetch): Promise<FoldersSnapshot> {
  try {
    const response = await fetchImpl(FOLDERS_ROUTE, {
      method: 'GET',
      // Folders are user state; a cached response would show stale rows.
      cache: 'no-store',
    })
    if (!response.ok) return { document: EMPTY_FOLDERS_DOCUMENT }
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return { document: EMPTY_FOLDERS_DOCUMENT }
    const source = body as Record<string, unknown>
    const remoteBase = typeof source.remoteBase === 'string' && source.remoteBase.trim() !== ''
      ? source.remoteBase.trim()
      : undefined
    const base = remoteBase === undefined ? {} : { remoteBase }
    if (source.version !== 1) return { document: EMPTY_FOLDERS_DOCUMENT, ...base }
    if (typeof source.workspaces !== 'object' || source.workspaces === null || Array.isArray(source.workspaces)) {
      return { document: { version: 1, workspaces: {} }, ...base }
    }
    const workspaces: Record<string, WorkspaceFolderEntry> = {}
    for (const [workspaceId, value] of Object.entries(source.workspaces)) {
      const entry = parseWireEntry(value)
      if (entry !== null) workspaces[workspaceId] = entry
    }
    return { document: { version: 1, workspaces }, ...base }
  } catch {
    return { document: EMPTY_FOLDERS_DOCUMENT }
  }
}

/**
 * Store the whole folder overlay.
 *
 * Unlike the tab strip this does NOT swallow failures: folder edits are explicit
 * row/dialog actions, so the caller turns a rejection into a toast instead of
 * leaving the user with a row that silently forgot its folder.
 * @param document - the client's current document.
 * @param fetchImpl - fetch implementation (injectable for tests).
 */
export async function saveFolders(
  document: FoldersDocument,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(FOLDERS_ROUTE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
    cache: 'no-store',
    // The write is idempotent, so surviving a navigation with keepalive is
    // safe and avoids losing the just-added folder.
    keepalive: true,
  })
  if (!response.ok) throw new Error(`PUT ${FOLDERS_ROUTE}: ${response.status}`)
}

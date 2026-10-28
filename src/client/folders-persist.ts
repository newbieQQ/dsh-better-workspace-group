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

/**
 * Read one workspace entry off the wire, dropping the entry when it is
 * unusable.
 * @param value - one value of the stored `workspaces` mapping.
 * @returns the entry, or null for a malformed one.
 */
function parseWireEntry(value: unknown): WorkspaceFolderEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!Array.isArray(row.folders)) return null
  const folders: string[] = []
  for (const candidate of row.folders) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    folders.push(candidate)
  }
  const root = typeof row.root === 'string' && row.root.trim() !== '' ? row.root : undefined
  return { folders, ...(root === undefined ? {} : { root }) }
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

/**
 * Ask the host to stamp the remote-ssh connection record into an extra folder of
 * a MIRROR workspace.
 *
 * remote-ssh decides "remote backed" by reading `.remote-ssh.json` at the
 * session cwd and never walks up, so a folder below the mirror root would
 * otherwise get a local terminal. Best-effort: the folder itself is already
 * persisted by the time this runs, and a local workspace answers `marked:false`
 * (nothing to stamp) rather than failing.
 * @param workspacePath - the workspace's canonical directory (mirror root).
 * @param folderPath - the extra folder just added.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns true when a record was written.
 */
export async function ensureRemoteFolderMarker(
  workspacePath: string,
  folderPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(FOLDERS_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspacePath, folderPath }),
      cache: 'no-store',
    })
    if (!response.ok) return false
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return false
    return (body as { marked?: unknown }).marked === true
  } catch {
    return false
  }
}

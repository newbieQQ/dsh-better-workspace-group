/**
 * Client side of the per-workspace folder list, talking to
 * `GET|PUT /workspace-groups/folders` on the host.
 *
 * The document is the host's JSON sidecar verbatim (`version` + `workspaces`),
 * so the client and the host agree on one shape: `folders` holds EXTRA folders
 * only — the workspace's canonical directory is implicit folder #0 — and
 * `root` names one of those extras (absent means "the workspace itself").
 *
 * SAFETY CONTRACT (this is the fix for the silent whole-document wipe):
 *
 *  - A failed read is NEVER "no extra folders". `loadFolders` returns
 *    `{ ok: false, error }` and the UI disables every edit. Previously a
 *    transient EACCES / EBUSY / torn JSON produced an empty document, and the
 *    next edit PUT that empty document back, erasing every workspace's folders.
 *  - Every write carries `If-Match: <revision>`. The host compares it with the
 *    sidecar's current revision and answers 409 on a mismatch, so two windows
 *    can no longer silently overwrite each other (lost update).
 *  - `saveFolders` returns the NEW revision. A caller must not issue a second
 *    write until it has stored it.
 *  - No `keepalive`: it silently truncates bodies above ~64 KiB, and the folder
 *    overlay may legitimately be larger than that. An explicit timeout replaces
 *    it so a hung request fails loudly instead of being dropped on navigation.
 */
import {
  EMPTY_FOLDERS_DOCUMENT,
  type FolderMember,
  type FoldersDocument,
  type WorkspaceFolderEntry,
} from '../core/folders.ts'

/** Host route holding the folder overlay. */
export const FOLDERS_ROUTE = '/workspace-groups/folders'

/** Give a write enough time to finish, but never let it hang forever. */
const SAVE_TIMEOUT_MS = 15_000

/** One successful read: the overlay plus the host's diagnostics and revision. */
export interface FoldersSnapshot {
  readonly document: FoldersDocument
  /**
   * Local mirror root of the remote-ssh plugin, when the host named one.
   * Workspaces whose directory lives below it are remote mirrors, so their extra
   * folders must be subdirectories of that same mirror.
   */
  readonly remoteBase?: string
  /** Set when `$DSH_HOME` and the hard-coded remote-ssh mirror root disagree. */
  readonly remoteBaseWarning?: string
  /** Set when the sidecar uses a schema version this build cannot safely edit. */
  readonly schemaWarning?: string
  /** Content hash of the sidecar this snapshot was built from (ETag value). */
  readonly revision?: string
}

/** Result of a read. `ok: false` means "do not render or write anything". */
export type FoldersLoadResult =
  | { readonly ok: true; readonly snapshot: FoldersSnapshot }
  | { readonly ok: false; readonly error: string }

/** A 409: the caller's baseline is stale; `current` is the server's document. */
export class FoldersConflictError extends Error {
  constructor(
    readonly current: FoldersSnapshot,
    message = 'workspace-groups: folders changed on another client',
  ) {
    super(message)
    this.name = 'FoldersConflictError'
  }
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
 * Read one workspace entry off the wire, dropping the entry only when it is
 * truly empty.
 *
 * `members` must survive this round trip: the client owns the whole document
 * (the PUT sends it back verbatim), so an entry parsed without its members is
 * not merely a display gap — the next folder edit would rewrite the sidecar and
 * erase every member-backed folder for good. An entry with only a `root` is
 * likewise kept (the host accepts it), instead of being dropped as before.
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
  const root = wireText(row.root)
  // An entry whose `folders` key is missing still carries its members: older
  // sidecars and hand-edited files use that shape. Only drop a truly empty one.
  if (folders.length === 0 && members.length === 0 && root === undefined) return null
  return {
    folders,
    ...(members.length === 0 ? {} : { members }),
    ...(root === undefined ? {} : { root }),
  }
}

/**
 * Parse the common GET / PUT / 409 response envelope.
 *
 * An unknown `version` does NOT produce an empty document that could be written
 * back. It produces `schemaWarning`, which the UI uses to disable editing: a
 * future schema must never be downgraded to v1 by this build.
 * @param body - decoded JSON response.
 * @returns the snapshot, or null when the envelope is unusable.
 */
export function parseFoldersSnapshot(body: unknown): FoldersSnapshot | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const source = body as Record<string, unknown>
  const remoteBase = wireText(source.remoteBase)
  const remoteBaseWarning = wireText(source.remoteBaseWarning)
  const schemaWarning = wireText(source.schemaWarning)
  const revision = wireText(source.revision)
  const diagnostics = {
    ...(remoteBase === undefined ? {} : { remoteBase }),
    ...(remoteBaseWarning === undefined ? {} : { remoteBaseWarning }),
    ...(schemaWarning === undefined ? {} : { schemaWarning }),
    ...(revision === undefined ? {} : { revision }),
  }
  if (source.version !== 1) {
    return {
      document: EMPTY_FOLDERS_DOCUMENT,
      ...diagnostics,
      schemaWarning: schemaWarning ?? `unknown folders schema version ${String(source.version)}`,
    }
  }
  if (typeof source.workspaces !== 'object' || source.workspaces === null
    || Array.isArray(source.workspaces)) {
    return { document: EMPTY_FOLDERS_DOCUMENT, ...diagnostics }
  }
  const workspaces: Record<string, WorkspaceFolderEntry> = {}
  for (const [workspaceId, value] of Object.entries(source.workspaces)) {
    const entry = parseWireEntry(value)
    if (entry !== null) workspaces[workspaceId] = entry
  }
  return { document: { version: 1, workspaces }, ...diagnostics }
}

/**
 * Fetch the stored folder overlay.
 *
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns `{ ok: true, snapshot }` or `{ ok: false, error }`. NEVER an empty
 * document on failure: the caller must disable edits instead.
 */
export async function loadFolders(fetchImpl: typeof fetch = fetch): Promise<FoldersLoadResult> {
  let response: Response
  try {
    response = await fetchImpl(FOLDERS_ROUTE, {
      method: 'GET',
      // Folders are user state; a cached response would show stale rows.
      cache: 'no-store',
    })
  } catch (error) {
    return { ok: false, error: `GET ${FOLDERS_ROUTE}: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (!response.ok) return { ok: false, error: `GET ${FOLDERS_ROUTE}: ${response.status}` }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    return { ok: false, error: `GET ${FOLDERS_ROUTE}: invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  const snapshot = parseFoldersSnapshot(body)
  if (snapshot === null) return { ok: false, error: `GET ${FOLDERS_ROUTE}: unexpected response shape` }
  return { ok: true, snapshot }
}

/** Build a bounded abort signal when the runtime supports it. */
function saveSignal(): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined
  return AbortSignal.timeout(SAVE_TIMEOUT_MS)
}

/**
 * Store the whole folder overlay with an optimistic-concurrency check.
 *
 * @param document - the client's current document.
 * @param expectedRevision - revision the document was derived from. Pass
 *   undefined only for a genuinely new sidecar; the host rejects an omitted
 *   If-Match when a document already exists.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns the new revision from the host's echo.
 * @throws {FoldersConflictError} on 409 — `current` holds the latest snapshot.
 */
export async function saveFolders(
  document: FoldersDocument,
  expectedRevision: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (expectedRevision !== undefined) headers['If-Match'] = expectedRevision
  const signal = saveSignal()
  const response = await fetchImpl(FOLDERS_ROUTE, {
    method: 'PUT',
    headers,
    body: JSON.stringify(document),
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) {
    if (response.status === 409) {
      let current: FoldersSnapshot
      try {
        const parsed = parseFoldersSnapshot(await response.json())
        current = parsed ?? { document: EMPTY_FOLDERS_DOCUMENT }
      } catch {
        current = { document: EMPTY_FOLDERS_DOCUMENT }
      }
      throw new FoldersConflictError(current)
    }
    throw new Error(`PUT ${FOLDERS_ROUTE}: ${response.status}`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  const echoed = parseFoldersSnapshot(body)
  return echoed?.revision ?? expectedRevision ?? ''
}

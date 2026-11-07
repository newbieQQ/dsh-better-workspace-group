/**
 * Folder overlay for @dsh-xhl/workspace-groups: the per-workspace list of
 * EXTRA folders plus the designated root folder. Stored in a plugin-owned JSON
 * sidecar (`$DSH_HOME/workspace-groups.folders.json`), next to the manual
 * grouping overlay, because neither DSH core nor the YAML rule source knows
 * about folders: core gives a workspace exactly one canonical directory and the
 * YAML stays the classification source.
 *
 * Writes are strict (the browser PUT route validates the whole document before
 * replacing it, atomically: temp file + fsync + rename), and reads tolerate
 * hand-edited content (junk entries are dropped instead of thrown) — BUT a
 * read that cannot even open or parse the file is now an ERROR, not an empty
 * document. Previously `readFoldersDocument` swallowed EACCES/EISDIR/EBUSY and
 * bad JSON; the browser then PUT the empty document back and erased every
 * workspace's folders with no warning.
 *
 * Concurrency: every write is guarded by `If-Match: <revision>` (a hash of the
 * exact bytes on disk) and serialized through a module-level promise chain, so
 * two windows cannot silently overwrite each other (lost update).
 */
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  EMPTY_FOLDERS_DOCUMENT,
  isAbsoluteFolderPath as isAbsoluteFolderPathCore,
  isUnderBase,
  samePath,
  type FolderMember,
  type FoldersDocument,
  type WorkspaceFolderEntry,
} from './core/folders.ts'

/** File name of the folder sidecar (also the stable error-text prefix). */
export const FOLDERS_FILE_NAME = 'workspace-groups.folders.json'

/** Hard limits enforced at the write boundary. */
export const FOLDERS_PER_WORKSPACE_LIMIT = 32
export const MEMBERS_PER_WORKSPACE_LIMIT = 16
export const WORKSPACE_ID_LIMIT = 200
export const FOLDER_PATH_LIMIT = 1024
export const REMOTE_PATH_LIMIT = 1024

/** Default overlay location: `$DSH_HOME/workspace-groups.folders.json`. */
export function defaultFoldersPath(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : resolve(homedir(), '.dsh')
  return resolve(home, FOLDERS_FILE_NAME)
}

/**
 * Local mirror root of `@zhangfengshun/dsh-remote-ssh`.
 *
 * That plugin registers every remote workspace as an ordinary DSH workspace
 * whose canonical directory is a LOCAL mirror (`<homedir>/.dsh/remote-workspaces/
 * <workspaceId>`) and keeps the real remote path in its own records. Telling the
 * browser this base lets it treat such workspaces differently: their extra
 * folders must be subdirectories of the mirror, because only those also exist on
 * the remote side.
 *
 * The path is hardcoded in that plugin (it does NOT read `DSH_HOME`), so it is
 * hardcoded here too. A custom `DSH_HOME` therefore makes PATH-BASED detection
 * unreliable: `remoteMirrorBaseDiagnostic()` surfaces that explicitly, and
 * write operations must still treat the SSH catalogue as authoritative.
 */
export function defaultRemoteMirrorBase(): string {
  return resolve(homedir(), '.dsh', 'remote-workspaces')
}

/** Mirror base plus a non-fatal diagnostic when it cannot be trusted. */
export interface RemoteMirrorBaseDiagnostic {
  readonly base: string
  readonly warning?: string
}

/**
 * Report a mismatch between `$DSH_HOME` and the hard-coded remote-ssh mirror
 * root. Silently returning a wrong base used to disable remote/local detection
 * with no symptom at all; the UI now shows `warning` instead.
 */
export function remoteMirrorBaseDiagnostic(): RemoteMirrorBaseDiagnostic {
  const base = defaultRemoteMirrorBase()
  const home = process.env.DSH_HOME
  if (home === undefined || home === '') return { base }
  if (resolve(home) === resolve(homedir(), '.dsh')) return { base }
  return {
    base,
    warning: `DSH_HOME is "${home}" but the remote-ssh mirror root is hard-coded to "${base}". Path-based remote detection is unreliable; SSH catalogue lookups remain authoritative.`,
  }
}

/**
 * Absolute-path test for SIDECAR data: delegated to `core/folders.ts` so the
 * host validator and the browser tree use exactly one spelling-based rule.
 * A sidecar may hold Windows and POSIX spellings at once (WSL, synced config,
 * a Windows client with a POSIX mirror), so `process.platform` must not decide.
 * @param path - candidate path.
 */
export function isAbsoluteFolderPath(path: string): boolean {
  return isAbsoluteFolderPathCore(path)
}

/** Platform-specific test for a LOCAL path used by the remote-hint endpoint. */
function isAbsoluteHostPath(path: string): boolean {
  return process.platform === 'win32'
    ? /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('\\\\')
    : path.startsWith('/')
}

/** Validate a local path for the read-only remote hint endpoint. */
export function validateRemoteHintPath(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > FOLDER_PATH_LIMIT
    || path.includes('\u0000') || !isAbsoluteHostPath(path)) {
    throw new Error('remote hint path must be an absolute host path without NUL, at most 1024 characters')
  }
  return path
}

/**
 * Presence-only safety hint, never a trusted SSH connection or registration.
 * lstat also treats dangling symlinks as hints without reading their targets.
 * Only ENOENT is ignored: permissions and all other inspection failures must
 * prevent callers from silently falling back to local operations.
 */
export async function hasRemoteMarkerHint(path: string): Promise<boolean> {
  let directory = resolve(validateRemoteHintPath(path))
  for (;;) {
    try {
      await lstat(resolve(directory, '.remote-ssh.json'))
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(directory)
    if (parent === directory) return false
    directory = parent
  }
}

/** Reject helper carrying the stable file-scoped message prefix. */
function invalid(detail: string): never {
  throw new Error(`${FOLDERS_FILE_NAME}: ${detail}`)
}

/** True when a path contains a `..` segment that would need resolving. */
function hasTraversalSegment(path: string): boolean {
  return path.split(/[\\/]+/u).includes('..')
}

/**
 * Trim one optional free-form string field.
 *
 * Invalid values now call `fail` instead of being silently dropped: in strict
 * (PUT) mode that is a 400, in tolerant (read) mode the field is dropped. The
 * old asymmetry — a bad TYPE rejected the whole PUT while an over-long value
 * returned 200 with the field quietly deleted — is gone.
 */
function optionalText(value: unknown, limit: number, fail: (detail: string) => void): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    fail('member text fields must be strings')
    return undefined
  }
  const text = value.trim()
  if (text === '' || text.length > limit || text.includes('\u0000')) {
    fail(`member text fields must be 1-${limit} characters without NUL`)
    return undefined
  }
  return text
}

/**
 * Parse one workspace-backed ("member") folder.
 *
 * A member names a real DSH workspace whose own sidebar row is hidden while this
 * entry lists it; the fields kept here are exactly what the browser needs to
 * start a Session in that workspace and to label the row.
 * @param value - raw member from the document.
 * @param workspaceId - owning workspace id (used in messages and as a guard).
 * @param folders - plain folder paths already accepted for this workspace.
 * @param members - member folders already accepted for this workspace.
 * @param strict - enforce the mirror-containment invariant on writes.
 * @param remoteBase - the local mirror root, for the containment check.
 * @param fail - strict-mode reporter (throws) / tolerant no-op.
 * @returns the normalized member, or undefined when unusable.
 */
function parseMember(
  value: unknown,
  workspaceId: string,
  folders: readonly string[],
  members: readonly FolderMember[],
  strict: boolean,
  remoteBase: string,
  fail: (detail: string) => void,
): FolderMember | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('member folders must be objects')
    return undefined
  }
  const source = value as Record<string, unknown>
  const rawPath = source.path
  if (typeof rawPath !== 'string') {
    fail('member folder path must be a string')
    return undefined
  }
  const path = rawPath.trim()
  if (path === '' || path.length > FOLDER_PATH_LIMIT || path.includes('\u0000')) {
    fail(`member folder path must be 1-${FOLDER_PATH_LIMIT} characters without NUL`)
    return undefined
  }
  if (!isAbsoluteFolderPath(path)) {
    fail(`member folder path "${path}" must be absolute`)
    return undefined
  }
  if (hasTraversalSegment(path)) {
    fail(`member folder path "${path}" must not contain ".." segments`)
    return undefined
  }
  if (folders.some(folder => samePath(folder, path)) || members.some(member => samePath(member.path, path))) {
    fail(`duplicate folder path "${path}"`)
    return undefined
  }
  const rawId = source.workspaceId
  if (typeof rawId !== 'string') {
    fail('member workspaceId must be a string')
    return undefined
  }
  const memberWorkspaceId = rawId.trim()
  if (memberWorkspaceId === '' || memberWorkspaceId.length > WORKSPACE_ID_LIMIT
    || memberWorkspaceId.includes('\u0000')) {
    fail(`member workspaceId must be 1-${WORKSPACE_ID_LIMIT} characters without NUL`)
    return undefined
  }
  if (memberWorkspaceId === workspaceId) {
    fail('a workspace cannot be a member folder of itself')
    return undefined
  }
  const kind = source.kind
  if (kind !== 'local' && kind !== 'remote') {
    fail('member kind must be "local" or "remote"')
    return undefined
  }
  const title = optionalText(source.title, FOLDER_PATH_LIMIT, fail)
  const keepTitle = title === undefined ? {} : { title }

  // A remote member's LOCAL path must be a directory inside the mirror base.
  // This is the host-side backstop for "never let a remote project point at an
  // unrelated local directory" (DEVELOPMENT.md / CHANGELOG.md). It is enforced
  // on writes only, so older sidecars stay readable.
  if (strict && kind === 'remote' && !isUnderBase(path, remoteBase)) {
    fail(`remote member path "${path}" must be inside the mirror base "${remoteBase}"`)
    return undefined
  }

  if (kind === 'local') return { path, workspaceId: memberWorkspaceId, kind, ...keepTitle }

  const rawRemote = source.remotePath
  if (typeof rawRemote !== 'string') {
    fail('a remote member folder needs its remotePath')
    return undefined
  }
  const remotePath = rawRemote.trim()
  if (remotePath === '' || remotePath.length > REMOTE_PATH_LIMIT || remotePath.includes('\u0000')) {
    fail(`member remotePath must be 1-${REMOTE_PATH_LIMIT} characters without NUL`)
    return undefined
  }
  const rawProfile = source.profileId
  if (typeof rawProfile !== 'string') {
    fail('a remote member folder needs its profileId')
    return undefined
  }
  const profileId = rawProfile.trim()
  if (profileId === '' || profileId.length > WORKSPACE_ID_LIMIT) {
    fail(`member profileId must be 1-${WORKSPACE_ID_LIMIT} characters`)
    return undefined
  }
  const recordId = optionalText(source.recordId, WORKSPACE_ID_LIMIT, fail)
  return {
    path,
    workspaceId: memberWorkspaceId,
    kind,
    remotePath,
    profileId,
    ...(recordId === undefined ? {} : { recordId }),
    ...keepTitle,
  }
}

/**
 * Parse one workspace entry.
 *
 * A missing `folders` key is treated as an empty list: older sidecars and
 * hand-edited files carry only `members`, and the old "folders is required"
 * check discarded the WHOLE entry (including every member) — which the next
 * full-document PUT then wrote back, permanently erasing those folders.
 * @param value - raw entry from the document.
 * @param workspaceId - owning workspace id (used in messages).
 * @param strict - throw on the first problem, or drop junk and return undefined.
 * @param remoteBase - the local mirror root, for remote member containment.
 * @returns the normalized entry, or undefined when nothing usable remains.
 */
function parseFolderEntry(
  value: unknown,
  workspaceId: string,
  strict: boolean,
  remoteBase: string,
): WorkspaceFolderEntry | undefined {
  const fail = (detail: string): void => {
    if (strict) invalid(`workspace "${workspaceId}": ${detail}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('entry must be an object')
    return undefined
  }
  const source = value as Record<string, unknown>
  if (source.folders !== undefined && !Array.isArray(source.folders)) {
    fail('folders must be a list')
    return undefined
  }
  const rawFolders: readonly unknown[] = Array.isArray(source.folders) ? source.folders : []
  if (strict && rawFolders.length > FOLDERS_PER_WORKSPACE_LIMIT) {
    invalid(`workspace "${workspaceId}": at most ${FOLDERS_PER_WORKSPACE_LIMIT} folders`)
  }

  const folders: string[] = []
  for (const candidate of rawFolders) {
    if (typeof candidate !== 'string') {
      fail('folder paths must be strings')
      continue
    }
    const path = candidate.trim()
    if (path === '') {
      fail('folder paths must be non-empty')
      continue
    }
    if (path.includes('\u0000')) {
      fail(`folder path "${path}" contains a NUL character`)
      continue
    }
    if (path.length > FOLDER_PATH_LIMIT) {
      fail(`folder path exceeds ${FOLDER_PATH_LIMIT} characters`)
      continue
    }
    if (!isAbsoluteFolderPath(path)) {
      fail(`folder path "${path}" must be absolute`)
      continue
    }
    if (hasTraversalSegment(path)) {
      fail(`folder path "${path}" must not contain ".." segments`)
      continue
    }
    if (folders.some(existing => samePath(existing, path))) {
      fail(`duplicate folder path "${path}"`)
      continue
    }
    if (folders.length >= FOLDERS_PER_WORKSPACE_LIMIT) {
      fail(`at most ${FOLDERS_PER_WORKSPACE_LIMIT} folders`)
      break
    }
    folders.push(path)
  }

  const members: FolderMember[] = []
  if (source.members !== undefined) {
    if (!Array.isArray(source.members)) {
      fail('members must be a list')
    } else {
      if (strict && source.members.length > MEMBERS_PER_WORKSPACE_LIMIT) {
        invalid(`workspace "${workspaceId}": at most ${MEMBERS_PER_WORKSPACE_LIMIT} member folders`)
      }
      for (const candidate of source.members) {
        const member = parseMember(candidate, workspaceId, folders, members, strict, remoteBase, fail)
        if (member !== undefined) members.push(member)
        if (members.length >= MEMBERS_PER_WORKSPACE_LIMIT) break
      }
    }
  }

  let root: string | undefined
  if (source.root !== undefined) {
    if (typeof source.root !== 'string') {
      fail('root must be a string')
    } else {
      const candidate = source.root.trim()
      const member = [...folders, ...members.map(entry => entry.path)]
        .find(folder => samePath(folder, candidate))
      if (member === undefined) fail(`root "${candidate}" must name one of folders`)
      else root = member
    }
  }

  if (folders.length === 0 && members.length === 0 && root === undefined) return undefined
  return { folders, ...(members.length === 0 ? {} : { members }), ...(root === undefined ? {} : { root }) }
}

/**
 * Drop members that point at a workspace which is itself an owner (or at the
 * owner itself). Such a workspace keeps its own sidebar row AND appeared as a
 * folder row of the other owner — two independent session lists for one
 * project. Strict writes reject them outright (see `validateFoldersDocument`);
 * this keeps old sidecars readable without showing the duplicate.
 */
function dropNestedMembers(doc: FoldersDocument): FoldersDocument {
  const owners = new Set(Object.keys(doc.workspaces))
  let changed = false
  const workspaces: Record<string, WorkspaceFolderEntry> = {}
  for (const [workspaceId, entry] of Object.entries(doc.workspaces)) {
    const members = entry.members ?? []
    const kept = members.filter(member =>
      member.workspaceId !== workspaceId && !owners.has(member.workspaceId))
    if (kept.length !== members.length) changed = true
    if (kept.length === 0 && entry.folders.length === 0 && entry.root === undefined) {
      changed = true
      continue
    }
    workspaces[workspaceId] = {
      ...entry,
      ...(kept.length === 0 ? {} : { members: kept }),
    }
  }
  return changed ? { version: 1, workspaces } : doc
}

/**
 * Tolerant reader: shape-normalizes whatever was on disk and drops unusable
 * workspaces, folders and roots instead of throwing. A missing, non-mapping or
 * unknown-version document yields the empty document — but ONLY when the file
 * could actually be read and parsed; `readFoldersState` is responsible for
 * reporting a read/parse failure as an error.
 * @param raw - parsed JSON value.
 */
export function parseFoldersDocument(raw: unknown): FoldersDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_FOLDERS_DOCUMENT
  const source = raw as Record<string, unknown>
  if (source.version !== 1) return EMPTY_FOLDERS_DOCUMENT
  if (typeof source.workspaces !== 'object' || source.workspaces === null || Array.isArray(source.workspaces)) {
    return { version: 1, workspaces: {} }
  }
  const remoteBase = defaultRemoteMirrorBase()
  const workspaces: Record<string, WorkspaceFolderEntry> = {}
  for (const [rawId, value] of Object.entries(source.workspaces)) {
    const workspaceId = rawId.trim()
    if (workspaceId === '' || rawId.length > WORKSPACE_ID_LIMIT) continue
    const entry = parseFolderEntry(value, workspaceId, false, remoteBase)
    if (entry !== undefined) workspaces[workspaceId] = entry
  }
  return dropNestedMembers({ version: 1, workspaces })
}

/**
 * Strict writer-side validation. Every rule is enforced and the first problem
 * throws, so the PUT route rejects instead of persisting a half-valid file.
 * @param raw - parsed JSON value from the request body.
 * @param remoteBase - mirror root used to constrain remote members.
 * @returns the normalized document to save.
 * @throws when version, workspace ids, folder paths, duplicates, the root
 * membership or cross-workspace references are wrong.
 */
export function validateFoldersDocument(raw: unknown, remoteBase = defaultRemoteMirrorBase()): FoldersDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    invalid('top-level value must be a mapping')
  }
  const source = raw as Record<string, unknown>
  if (source.version !== 1) invalid('version must be 1')
  if (typeof source.workspaces !== 'object' || source.workspaces === null || Array.isArray(source.workspaces)) {
    invalid('workspaces must be a mapping')
  }
  const workspaces: Record<string, WorkspaceFolderEntry> = {}
  for (const [rawId, value] of Object.entries(source.workspaces)) {
    const workspaceId = rawId.trim()
    if (workspaceId === '' || rawId.length > WORKSPACE_ID_LIMIT) {
      invalid(`workspace ids must be non-empty strings of at most ${WORKSPACE_ID_LIMIT} characters`)
    }
    if (workspaces[workspaceId] !== undefined) invalid(`duplicate workspace id "${workspaceId}"`)
    const entry = parseFolderEntry(value, workspaceId, true, remoteBase)
    if (entry !== undefined) workspaces[workspaceId] = entry
  }
  // Cross-entry referential integrity: a member that is itself an owner would
  // be rendered twice (see dropNestedMembers). Reject it on write.
  const owners = new Set(Object.keys(workspaces))
  for (const [workspaceId, entry] of Object.entries(workspaces)) {
    for (const member of entry.members ?? []) {
      if (owners.has(member.workspaceId)) {
        invalid(`workspace "${workspaceId}": member "${member.workspaceId}" is itself a folder owner`)
      }
    }
  }
  return { version: 1, workspaces }
}

/** Non-fatal diagnostic when the on-disk schema is newer than this build. */
function detectSchemaWarning(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const version = (raw as Record<string, unknown>).version
  return version === 1
    ? undefined
    : `unknown folders schema version ${String(version)}; editing is disabled to avoid downgrading the file`
}

/** Exact state of the sidecar, including the revision used by `If-Match`. */
export interface FoldersState {
  readonly document: FoldersDocument
  /** First 16 hex chars of sha256 over the exact on-disk bytes; '' when missing. */
  readonly revision: string
  /** True when the file does not exist (a legitimate empty overlay). */
  readonly missing: boolean
  readonly schemaWarning?: string
}

/** Hash the exact text so the ETag changes on every real write. */
function revisionOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Read the sidecar WITHOUT swallowing real I/O errors.
 *
 * ENOENT means "no overlay yet" and is a legitimate empty document. EACCES,
 * EISDIR, EBUSY and invalid JSON are errors: returning an empty document for
 * them was the root cause of the whole-overlay wipe, because the browser would
 * PUT the empty result back on the next edit.
 * @param path - overlay file path.
 */
export async function readFoldersState(path: string): Promise<FoldersState> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { document: EMPTY_FOLDERS_DOCUMENT, revision: '', missing: true }
    }
    throw new Error(`${FOLDERS_FILE_NAME}: cannot read overlay: ${error instanceof Error ? error.message : String(error)}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`${FOLDERS_FILE_NAME}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const schemaWarning = detectSchemaWarning(raw)
  return {
    document: parseFoldersDocument(raw),
    revision: revisionOf(text),
    missing: false,
    ...(schemaWarning === undefined ? {} : { schemaWarning }),
  }
}

/**
 * Legacy tolerant reader kept for the verifier scripts. New code must use
 * `readFoldersState` so a read failure is not mistaken for an empty overlay.
 * @param path - overlay file path.
 */
export async function readFoldersDocument(path: string): Promise<FoldersDocument> {
  try {
    return (await readFoldersState(path)).document
  } catch {
    return EMPTY_FOLDERS_DOCUMENT
  }
}

/** Atomically replace `path` with `json` (temp + fsync + rename). */
async function atomicWrite(path: string, json: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(json, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(tmp).catch(() => {})
    throw error
  }
  await handle.close()
  try {
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
  // fsync the parent directory so the rename itself survives a crash.
  // Best-effort: Windows and some filesystems reject opening a directory.
  try {
    const dir = await open(dirname(path), 'r')
    try { await dir.sync() } finally { await dir.close() }
  } catch { /* not supported on this filesystem */ }
}

/**
 * Atomically replace the overlay file. Kept as the public single-document
 * writer used by the verifier scripts; the HTTP route uses
 * `replaceFoldersDocument` instead, which adds the CAS guard.
 * @param path - target file path.
 * @param document - validated document to persist.
 */
export async function writeFoldersDocument(path: string, document: FoldersDocument): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(document, null, 2)}\n`)
}

/** Outcome of a guarded replace. */
export type FoldersReplaceResult =
  | { readonly ok: true; readonly revision: string }
  | { readonly ok: false; readonly kind: 'conflict'; readonly state: FoldersState }

/** Serializes read → compare → write so concurrent PUTs cannot interleave. */
let writeChain: Promise<unknown> = Promise.resolve()

/**
 * Compare-and-swap the whole overlay under a per-process write lock.
 *
 * `expectedRevision` must be the revision the caller's document was derived
 * from. A mismatch returns `conflict` with the server's current state; the
 * route answers 409 with that document so the client can reload instead of
 * overwriting. Omitting If-Match is allowed only when the sidecar does not
 * exist yet (first write).
 * @param path - overlay file path.
 * @param expectedRevision - `If-Match` value, or undefined.
 * @param document - already validated document to persist.
 */
export async function replaceFoldersDocument(
  path: string,
  expectedRevision: string | undefined,
  document: FoldersDocument,
): Promise<FoldersReplaceResult> {
  const task = async (): Promise<FoldersReplaceResult> => {
    const current = await readFoldersState(path)
    // An unknown on-disk schema must never be downgraded to v1, even when the
    // caller somehow holds a matching revision. Report it as a conflict so the
    // client reloads, sees schemaWarning and keeps editing disabled.
    if (!current.missing && (current.schemaWarning !== undefined || expectedRevision !== current.revision)) {
      return { ok: false, kind: 'conflict', state: current }
    }
    const json = `${JSON.stringify(document, null, 2)}\n`
    await atomicWrite(path, json)
    return { ok: true, revision: revisionOf(json) }
  }
  const run = writeChain.then(task, task)
  writeChain = run.catch(() => undefined)
  return run
}

// Do not copy remote-ssh records into subdirectories. Remote-ssh 2.4.40
// resolves model-tool context only at registered roots; child records do not
// register a workspace and can bypass the parent's writeBack guard.
// Existing records belong to the user / remote-ssh and are left untouched.

/**
 * Join a remote path with a mirror-relative subpath.
 *
 * The remote path is POSIX (the server's), so this never uses `node:path`:
 * a Windows host would otherwise hand `/home/me/proj\data` to the remote shell.
 *
 * Absolute inputs (POSIX `/…`, Windows drive `C:…`, UNC `\\…`) are rejected,
 * matching `core/folders.ts:joinSubpath`. The old version stripped leading
 * slashes, so `/etc/x` became `etc/x` on the remote while the local mirror
 * side rejected it — the two sides disagreed about the same folder.
 * @param remotePath - the workspace's remote root (`~`, `~/proj`, `/srv/proj`).
 * @param relativePath - subpath inside the mirror, either separator style.
 * @returns the remote counterpart, or null for an empty, absolute or escaping subpath.
 */
export function remoteSubpath(remotePath: string, relativePath: string): string | null {
  const raw = relativePath.trim()
  if (raw === '') return null
  if (/^[A-Za-z]:/u.test(raw) || raw.startsWith('\\') || raw.startsWith('/')) return null
  const rel = raw.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')
  if (rel === '') return null
  if (rel.split('/').some(segment => segment === '..' || segment === '.')) return null
  const base = remotePath === '~' ? '~' : remotePath.replace(/\/+$/u, '')
  return base === '' ? rel : `${base}/${rel}`
}

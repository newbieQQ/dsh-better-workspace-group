/**
 * Folder overlay for @dsh-xhl/workspace-groups: the per-workspace list of
 * EXTRA folders plus the designated root folder. Stored in a plugin-owned JSON
 * sidecar (`$DSH_HOME/workspace-groups.folders.json`), next to the manual
 * grouping overlay, because neither DSH core nor the YAML rule source knows
 * about folders: core gives a workspace exactly one canonical directory and the
 * YAML stays the classification source.
 *
 * Writes are strict (the browser PUT route validates the whole document before
 * replacing it, atomically: temp file + fsync + rename) and reads tolerate
 * hand-edited content (junk entries are dropped instead of thrown), for the
 * same reason the manual overlay does: a stale or malformed sidecar must never
 * freeze the tree.
 */
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import {
  EMPTY_FOLDERS_DOCUMENT,
  samePath,
  type FoldersDocument,
  type WorkspaceFolderEntry,
} from './core/folders.ts'

/** File name of the folder sidecar (also the stable error-text prefix). */
export const FOLDERS_FILE_NAME = 'workspace-groups.folders.json'

/** Hard limits enforced at the write boundary. */
export const FOLDERS_PER_WORKSPACE_LIMIT = 32
export const WORKSPACE_ID_LIMIT = 200
export const FOLDER_PATH_LIMIT = 1024

/** `C:\…` or `C:/…` — a drive-rooted Windows path. */
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/u

/** `\\server\share` — a Windows UNC path. */
const WINDOWS_UNC = /^\\\\/u

/** `/…` — a POSIX absolute path. */
const POSIX_ABSOLUTE = /^\//u

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
 * The path is hardcoded there (not read from `DSH_HOME`), so it is hardcoded
 * here too — a mismatch would silently disable the distinction.
 */
export function defaultRemoteMirrorBase(): string {
  return resolve(homedir(), '.dsh', 'remote-workspaces')
}

/**
 * True when `path` is absolute in the host platform's spelling: a drive
 * letter or UNC prefix on Windows, a leading slash elsewhere.
 * @param path - candidate path.
 */
export function isAbsoluteFolderPath(path: string): boolean {
  return process.platform === 'win32'
    ? WINDOWS_DRIVE.test(path) || WINDOWS_UNC.test(path)
    : POSIX_ABSOLUTE.test(path)
}

/** Reject helper carrying the stable file-scoped message prefix. */
function invalid(detail: string): never {
  throw new Error(`${FOLDERS_FILE_NAME}: ${detail}`)
}

/**
 * Parse one workspace entry.
 * @param value - raw entry from the document.
 * @param workspaceId - owning workspace id (used in messages).
 * @param strict - throw on the first problem, or drop junk and return undefined.
 * @returns the normalized entry, or undefined when nothing usable remains.
 */
function parseFolderEntry(
  value: unknown,
  workspaceId: string,
  strict: boolean,
): WorkspaceFolderEntry | undefined {
  const fail = (detail: string): void => {
    if (strict) invalid(`workspace "${workspaceId}": ${detail}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('entry must be an object')
    return undefined
  }
  const source = value as Record<string, unknown>
  if (source.folders === undefined) {
    fail('folders is required')
    return undefined
  }
  if (!Array.isArray(source.folders)) {
    fail('folders must be a list')
    return undefined
  }
  if (strict && source.folders.length > FOLDERS_PER_WORKSPACE_LIMIT) {
    invalid(`workspace "${workspaceId}": at most ${FOLDERS_PER_WORKSPACE_LIMIT} folders`)
  }

  const folders: string[] = []
  for (const candidate of source.folders) {
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

  let root: string | undefined
  if (source.root !== undefined) {
    if (typeof source.root !== 'string') {
      fail('root must be a string')
    } else {
      const candidate = source.root.trim()
      const member = folders.find(folder => samePath(folder, candidate))
      if (member === undefined) fail(`root "${candidate}" must name one of folders`)
      else root = member
    }
  }

  if (folders.length === 0 && root === undefined) return undefined
  return { folders, ...(root === undefined ? {} : { root }) }
}

/**
 * Tolerant reader: shape-normalizes whatever was on disk and drops unusable
 * workspaces, folders and roots instead of throwing. A missing, non-mapping or
 * unknown-version document yields the empty document.
 * @param raw - parsed JSON value.
 */
export function parseFoldersDocument(raw: unknown): FoldersDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_FOLDERS_DOCUMENT
  const source = raw as Record<string, unknown>
  if (source.version !== 1) return EMPTY_FOLDERS_DOCUMENT
  if (typeof source.workspaces !== 'object' || source.workspaces === null || Array.isArray(source.workspaces)) {
    return { version: 1, workspaces: {} }
  }
  const workspaces: Record<string, WorkspaceFolderEntry> = {}
  for (const [workspaceId, value] of Object.entries(source.workspaces)) {
    if (workspaceId.trim() === '' || workspaceId.length > WORKSPACE_ID_LIMIT) continue
    const entry = parseFolderEntry(value, workspaceId, false)
    if (entry !== undefined) workspaces[workspaceId] = entry
  }
  return { version: 1, workspaces }
}

/**
 * Strict writer-side validation. Every rule is enforced and the first problem
 * throws, so the PUT route rejects instead of persisting a half-valid file.
 * @param raw - parsed JSON value from the request body.
 * @returns the normalized document to save.
 * @throws when version, workspace ids, folder paths, duplicates or the root
 * membership are wrong.
 */
export function validateFoldersDocument(raw: unknown): FoldersDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    invalid('top-level value must be a mapping')
  }
  const source = raw as Record<string, unknown>
  if (source.version !== 1) invalid('version must be 1')
  if (typeof source.workspaces !== 'object' || source.workspaces === null || Array.isArray(source.workspaces)) {
    invalid('workspaces must be a mapping')
  }
  const workspaces: Record<string, WorkspaceFolderEntry> = {}
  for (const [workspaceId, value] of Object.entries(source.workspaces)) {
    if (workspaceId.trim() === '' || workspaceId.length > WORKSPACE_ID_LIMIT) {
      invalid(`workspace ids must be non-empty strings of at most ${WORKSPACE_ID_LIMIT} characters`)
    }
    const entry = parseFolderEntry(value, workspaceId, true)
    if (entry !== undefined) workspaces[workspaceId] = entry
  }
  return { version: 1, workspaces }
}

/**
 * Read + tolerate the overlay file. A missing or unreadable file yields the
 * empty document: folders are a convenience, and a broken sidecar must not take
 * the tree down with it.
 * @param path - overlay file path.
 */
export async function readFoldersDocument(path: string): Promise<FoldersDocument> {
  try {
    const text = await readFile(path, 'utf8')
    return parseFoldersDocument(JSON.parse(text))
  } catch {
    return EMPTY_FOLDERS_DOCUMENT
  }
}

/**
 * Atomically replace the overlay file: write a same-directory temp file,
 * fsync it, then rename over the target. A crash never leaves a torn JSON at
 * the real path (readers see either the old or the new file).
 * @param path - target file path.
 * @param document - validated document to persist.
 */
export async function writeFoldersDocument(path: string, document: FoldersDocument): Promise<void> {
  const json = `${JSON.stringify(document, null, 2)}\n`
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
}

// ---------------------------------------------------------------------------
// remote-ssh markers
//
// `@zhangfengshun/dsh-remote-ssh` decides "this directory belongs to a remote
// workspace" by looking for a `.remote-ssh.json` connection record at the
// directory itself (the shell wrapper and several fs bridges read exactly one
// path, they do NOT walk up). Its mirror root carries one; a plain subdirectory
// of the mirror does not, so a session whose cwd is such a subdirectory falls
// back to a LOCAL terminal even though every file under it is remote-backed.
//
// Stamping the record into the subdirectory fixes that: the record holds the
// same connection with `remotePath` adjusted to the matching remote folder, and
// remote-ssh always excludes `.remote-ssh.json` from sync, so it never travels
// to the server.
// ---------------------------------------------------------------------------

/** Connection record of the remote-ssh plugin at a mirror root. */
export const REMOTE_MARKER_FILE_NAME = '.remote-ssh.json'

/** The subset of that record this plugin needs to reproduce it. */
export interface RemoteMarker {
  readonly profileId?: string
  readonly host: string
  readonly port: number
  readonly user: string
  readonly keyPath?: string
  readonly proxyJump?: string
  readonly remotePath: string
}

/**
 * Read the remote-ssh connection record of a directory.
 * @param dir - directory that may hold the record (a mirror root, usually).
 * @returns the record, or null when the directory is not remote-backed.
 */
export async function readRemoteMarker(dir: string): Promise<RemoteMarker | null> {
  let text: string
  try {
    text = await readFile(resolve(dir, REMOTE_MARKER_FILE_NAME), 'utf8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const row = parsed as Record<string, unknown>
  if (typeof row.host !== 'string' || row.host === '') return null
  if (typeof row.user !== 'string' || row.user === '') return null
  const port = typeof row.port === 'number' && Number.isInteger(row.port) && row.port > 0 ? row.port : 22
  const remotePath = typeof row.remotePath === 'string' ? row.remotePath.trim() : ''
  if (remotePath === '') return null
  return {
    ...(typeof row.profileId === 'string' && row.profileId !== '' ? { profileId: row.profileId } : {}),
    host: row.host,
    port,
    user: row.user,
    ...(typeof row.keyPath === 'string' ? { keyPath: row.keyPath } : {}),
    ...(typeof row.proxyJump === 'string' && row.proxyJump !== '' ? { proxyJump: row.proxyJump } : {}),
    remotePath,
  }
}

/**
 * Join a remote path with a mirror-relative subpath.
 *
 * The remote path is POSIX (the server's), so this never uses `node:path`:
 * a Windows host would otherwise hand `/home/me/proj\data` to the remote shell.
 * @param remotePath - the workspace's remote root (`~`, `~/proj`, `/srv/proj`).
 * @param relativePath - subpath inside the mirror, either separator style.
 * @returns the remote counterpart, or null for an empty or escaping subpath.
 */
export function remoteSubpath(remotePath: string, relativePath: string): string | null {
  const rel = relativePath.trim().replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')
  if (rel === '') return null
  if (rel.split('/').some(segment => segment === '..' || segment === '.')) return null
  const base = remotePath === '~' ? '~' : remotePath.replace(/\/+$/u, '')
  return base === '' ? rel : `${base}/${rel}`
}

/**
 * Stamp the remote-ssh connection record into a subdirectory of a mirror, so
 * that sessions started there keep a remote terminal (see the block comment).
 *
 * A workspace that is not remote-backed is left untouched: no record at the
 * workspace root means the plugin has nothing to reproduce.
 * @param workspacePath - the workspace's canonical directory (the mirror root).
 * @param folderPath - subdirectory added as an extra folder.
 * @returns `{ marked: false }` for a local workspace, otherwise the remote path
 * written into the subdirectory record.
 */
export async function ensureRemoteMarker(
  workspacePath: string,
  folderPath: string,
): Promise<{ marked: boolean; remotePath?: string }> {
  const base = resolve(workspacePath)
  const folder = resolve(folderPath)
  const rel = relative(base, folder)
  if (rel === '' || rel.startsWith('..')) {
    throw invalid('folder is not inside the workspace directory')
  }
  const marker = await readRemoteMarker(base)
  if (marker === null) return { marked: false }
  const remotePath = remoteSubpath(marker.remotePath, rel.split(sep).join('/'))
  if (remotePath === null) throw invalid('remote subpath is unusable')
  const record: RemoteMarker = {
    ...(marker.profileId === undefined ? {} : { profileId: marker.profileId }),
    host: marker.host,
    port: marker.port,
    user: marker.user,
    ...(marker.keyPath === undefined ? {} : { keyPath: marker.keyPath }),
    ...(marker.proxyJump === undefined ? {} : { proxyJump: marker.proxyJump }),
    remotePath,
  }
  await mkdir(folder, { recursive: true })
  await writeFile(resolve(folder, REMOTE_MARKER_FILE_NAME), JSON.stringify(record, null, 2), 'utf8')
  return { marked: true, remotePath }
}

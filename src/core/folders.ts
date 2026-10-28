/**
 * Pure folder-list logic for per-workspace multi-root folders.
 *
 * DSH core gives a workspace exactly ONE canonical directory
 * (`WorkspaceView.path`). This module layers a plugin-owned list of EXTRA
 * folders on top of it, plus one designated root folder per workspace:
 *
 *   - the canonical directory is always folder #0 (the "base"); it cannot be
 *     removed and may be the root;
 *   - `root` is stored only when it names an EXTRA folder — "base is the root"
 *     is expressed by omitting the key, so the base path is never duplicated
 *     into the sidecar;
 *   - a session whose recorded `cwd` lives inside an extra folder belongs to
 *     that folder, not to the project row.
 *
 * Everything here is pure and platform-agnostic: it imports no React, no DOM
 * and no cordis so plain Node (the verifier, the host route) can load it.
 */

/** Folders attached to one workspace: EXTRA folders only (the base is implicit). */
export interface WorkspaceFolderEntry {
  readonly folders: readonly string[]
  readonly root?: string
}

/** The whole `workspace-groups.folders.json` document. */
export interface FoldersDocument {
  readonly version: 1
  readonly workspaces: Readonly<Record<string, WorkspaceFolderEntry>>
}

/** Canonical empty document, shared so callers need not allocate one each time. */
export const EMPTY_FOLDERS_DOCUMENT: FoldersDocument = { version: 1, workspaces: {} }

/** `C:\…` or `C:/…` — a drive-rooted Windows path. */
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/u

/** `\\server\share` — a Windows UNC path. */
const WINDOWS_UNC = /^\\\\/u

/** True for both Windows path spellings accepted by the write validator. */
function isWindowsStyle(path: string): boolean {
  return WINDOWS_DRIVE.test(path) || WINDOWS_UNC.test(path)
}

/**
 * One path with trailing separators removed, spelling preserved (no case
 * folding) — the form to STORE. A drive/UNC/root prefix keeps its separator.
 * @param path - raw path.
 */
function withoutTrailingSeparator(path: string): string {
  if (isWindowsStyle(path)) {
    let value = path.replaceAll('/', '\\')
    while (value.length > 3 && value.endsWith('\\')) value = value.slice(0, -1)
    return value
  }
  let value = path
  while (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1)
  return value
}

/**
 * Comparison form of one path: trimmed, separator-normalized and, for Windows
 * spellings, lower-cased (drive letters and file names are case-insensitive
 * there). Trailing separators are dropped except for a drive/UNC/root prefix.
 * @param path - raw path as stored or picked.
 * @returns the canonical comparison form.
 */
function canonicalPath(path: string): string {
  const trimmed = path.trim()
  const value = withoutTrailingSeparator(trimmed)
  return isWindowsStyle(trimmed) ? value.toLowerCase() : value
}

/**
 * Path equality: case-insensitive for Windows-style paths, tolerant of
 * trailing separators, exact for POSIX paths.
 * @param a - first path.
 * @param b - second path.
 */
export function samePath(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b)
}

/**
 * Look up the folder entry saved for one workspace.
 * @param doc - folders document.
 * @param workspaceId - host workspace id.
 * @returns the entry, or undefined when the workspace has none.
 */
export function entryFor(doc: FoldersDocument, workspaceId: string): WorkspaceFolderEntry | undefined {
  return doc.workspaces[workspaceId]
}

/**
 * The workspace's effective folder list, base first. The base cannot be
 * duplicated and blank extra entries are dropped.
 * @param workspacePath - canonical directory of the workspace.
 * @param entry - saved folder entry, if any.
 */
export function effectiveFolders(
  workspacePath: string,
  entry: WorkspaceFolderEntry | undefined,
): readonly string[] {
  const extras: string[] = []
  for (const folder of entry?.folders ?? []) {
    if (folder.trim() === '') continue
    if (samePath(folder, workspacePath)) continue
    if (extras.some(existing => samePath(existing, folder))) continue
    extras.push(folder)
  }
  return [workspacePath, ...extras]
}

/**
 * The folder new sessions start in by default.
 * @param workspacePath - canonical directory of the workspace.
 * @param entry - saved folder entry, if any.
 * @returns the stored root when it names an effective extra folder, else the
 * workspace's own directory.
 */
export function rootOf(workspacePath: string, entry: WorkspaceFolderEntry | undefined): string {
  const root = entry?.root
  if (root === undefined) return workspacePath
  const folders = effectiveFolders(workspacePath, entry)
  return folders.find(folder => samePath(folder, root)) ?? workspacePath
}

/**
 * Owning folder of a session cwd: the most specific (longest) effective folder
 * that equals the cwd or is a proper path ancestor of it.
 * @param cwd - recorded session cwd; undefined means "the workspace itself".
 * @param workspacePath - canonical directory of the workspace.
 * @param entry - saved folder entry, if any.
 * @returns the owning folder, or the workspace path when nothing matches.
 */
export function folderOfCwd(
  cwd: string | undefined,
  workspacePath: string,
  entry: WorkspaceFolderEntry | undefined,
): string {
  if (cwd === undefined) return workspacePath
  const target = canonicalPath(cwd)
  let best: string | undefined
  let bestLength = -1
  for (const folder of effectiveFolders(workspacePath, entry)) {
    const root = canonicalPath(folder)
    if (root === '') continue
    const separator = isWindowsStyle(root) ? '\\' : '/'
    const prefix = root.endsWith(separator) ? root : `${root}${separator}`
    if (target !== root && !target.startsWith(prefix)) continue
    if (root.length > bestLength) {
      best = folder
      bestLength = root.length
    }
  }
  return best ?? workspacePath
}

/**
 * Append an extra folder. Idempotent under `samePath`, and the stored root (if
 * any) survives untouched.
 * @param entry - current entry, or undefined for a workspace with no extras.
 * @param path - folder path to append.
 */
export function addFolder(entry: WorkspaceFolderEntry | undefined, path: string): WorkspaceFolderEntry {
  const folders = entry?.folders ?? []
  const root = entry?.root
  const trimmed = path.trim()
  const keepRoot = root === undefined ? {} : { root }
  if (trimmed === '' || folders.some(folder => samePath(folder, trimmed))) {
    return { folders: [...folders], ...keepRoot }
  }
  return { folders: [...folders, trimmed], ...keepRoot }
}

/**
 * Drop an extra folder. A root that pointed at it is cleared, so the workspace
 * falls back to its own directory instead of referencing a folder it no longer
 * has.
 * @param entry - current entry, or undefined.
 * @param path - folder path to drop.
 */
export function removeFolder(entry: WorkspaceFolderEntry | undefined, path: string): WorkspaceFolderEntry {
  const folders = entry?.folders ?? []
  const remaining = folders.filter(folder => !samePath(folder, path))
  const root = entry?.root
  const keepRoot = root !== undefined && !samePath(root, path)
  return { folders: remaining, ...(keepRoot ? { root } : {}) }
}

/**
 * Designate the root folder. Only an extra folder can be stored: naming the
 * base directory means "no explicit root", which is represented by clearing
 * the key.
 * @param entry - current entry, or undefined.
 * @param path - folder to make the root.
 */
export function setRoot(entry: WorkspaceFolderEntry | undefined, path: string): WorkspaceFolderEntry {
  const folders = entry?.folders ?? []
  const match = folders.find(folder => samePath(folder, path))
  if (match === undefined) return { folders: [...folders] }
  return { folders: [...folders], root: match }
}

/**
 * True when `path` is `base` itself or lives somewhere below it, with the same
 * separator and case rules as {@link samePath}.
 * @param path - candidate path.
 * @param base - containing directory.
 */
export function isUnderBase(path: string, base: string): boolean {
  const root = canonicalPath(base)
  const target = canonicalPath(path)
  if (root === '' || target === '') return false
  if (target === root) return true
  const separator = isWindowsStyle(root) ? '\\' : '/'
  const prefix = root.endsWith(separator) ? root : `${root}${separator}`
  return target.startsWith(prefix)
}

/**
 * Resolve a user-typed SUBPATH against a base directory.
 *
 * This is what remote (mirror-backed) workspaces need: their canonical
 * directory is a local mirror of a remote root, so an extra folder must be a
 * directory INSIDE the mirror — that is the only spelling that also exists on
 * the remote side. Absolute input and `..` escapes are rejected outright so a
 * typo cannot smuggle in an unrelated local directory.
 * @param base - the workspace's canonical directory.
 * @param relative - typed subpath, either separator style.
 * @returns the joined path, or null when the input is empty, absolute, or
 * escapes the base.
 */
export function joinSubpath(base: string, relative: string): string | null {
  const root = base.trim()
  const raw = relative.trim()
  if (root === '' || raw === '') return null
  if (WINDOWS_DRIVE.test(raw) || WINDOWS_UNC.test(raw) || raw.startsWith('/')) return null
  const segments = raw.split(/[\\/]+/u).filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) return null
  if (segments.includes('..')) return null
  const windows = isWindowsStyle(root)
  const separator = windows ? '\\' : '/'
  return `${withoutTrailingSeparator(root)}${separator}${segments.join(separator)}`
}

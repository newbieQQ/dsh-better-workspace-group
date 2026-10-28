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
    readonly folders: readonly string[];
    readonly root?: string;
}
/** The whole `workspace-groups.folders.json` document. */
export interface FoldersDocument {
    readonly version: 1;
    readonly workspaces: Readonly<Record<string, WorkspaceFolderEntry>>;
}
/** Canonical empty document, shared so callers need not allocate one each time. */
export declare const EMPTY_FOLDERS_DOCUMENT: FoldersDocument;
/**
 * Path equality: case-insensitive for Windows-style paths, tolerant of
 * trailing separators, exact for POSIX paths.
 * @param a - first path.
 * @param b - second path.
 */
export declare function samePath(a: string, b: string): boolean;
/**
 * Look up the folder entry saved for one workspace.
 * @param doc - folders document.
 * @param workspaceId - host workspace id.
 * @returns the entry, or undefined when the workspace has none.
 */
export declare function entryFor(doc: FoldersDocument, workspaceId: string): WorkspaceFolderEntry | undefined;
/**
 * The workspace's effective folder list, base first. The base cannot be
 * duplicated and blank extra entries are dropped.
 * @param workspacePath - canonical directory of the workspace.
 * @param entry - saved folder entry, if any.
 */
export declare function effectiveFolders(workspacePath: string, entry: WorkspaceFolderEntry | undefined): readonly string[];
/**
 * The folder new sessions start in by default.
 * @param workspacePath - canonical directory of the workspace.
 * @param entry - saved folder entry, if any.
 * @returns the stored root when it names an effective extra folder, else the
 * workspace's own directory.
 */
export declare function rootOf(workspacePath: string, entry: WorkspaceFolderEntry | undefined): string;
/**
 * Owning folder of a session cwd: the most specific (longest) effective folder
 * that equals the cwd or is a proper path ancestor of it.
 * @param cwd - recorded session cwd; undefined means "the workspace itself".
 * @param workspacePath - canonical directory of the workspace.
 * @param entry - saved folder entry, if any.
 * @returns the owning folder, or the workspace path when nothing matches.
 */
export declare function folderOfCwd(cwd: string | undefined, workspacePath: string, entry: WorkspaceFolderEntry | undefined): string;
/**
 * Append an extra folder. Idempotent under `samePath`, and the stored root (if
 * any) survives untouched.
 * @param entry - current entry, or undefined for a workspace with no extras.
 * @param path - folder path to append.
 */
export declare function addFolder(entry: WorkspaceFolderEntry | undefined, path: string): WorkspaceFolderEntry;
/**
 * Drop an extra folder. A root that pointed at it is cleared, so the workspace
 * falls back to its own directory instead of referencing a folder it no longer
 * has.
 * @param entry - current entry, or undefined.
 * @param path - folder path to drop.
 */
export declare function removeFolder(entry: WorkspaceFolderEntry | undefined, path: string): WorkspaceFolderEntry;
/**
 * Designate the root folder. Only an extra folder can be stored: naming the
 * base directory means "no explicit root", which is represented by clearing
 * the key.
 * @param entry - current entry, or undefined.
 * @param path - folder to make the root.
 */
export declare function setRoot(entry: WorkspaceFolderEntry | undefined, path: string): WorkspaceFolderEntry;
/**
 * True when `path` is `base` itself or lives somewhere below it, with the same
 * separator and case rules as {@link samePath}.
 * @param path - candidate path.
 * @param base - containing directory.
 */
export declare function isUnderBase(path: string, base: string): boolean;
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
export declare function joinSubpath(base: string, relative: string): string | null;

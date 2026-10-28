import { type FoldersDocument } from './core/folders.ts';
/** File name of the folder sidecar (also the stable error-text prefix). */
export declare const FOLDERS_FILE_NAME = "workspace-groups.folders.json";
/** Hard limits enforced at the write boundary. */
export declare const FOLDERS_PER_WORKSPACE_LIMIT = 32;
export declare const WORKSPACE_ID_LIMIT = 200;
export declare const FOLDER_PATH_LIMIT = 1024;
/** Default overlay location: `$DSH_HOME/workspace-groups.folders.json`. */
export declare function defaultFoldersPath(): string;
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
export declare function defaultRemoteMirrorBase(): string;
/**
 * True when `path` is absolute in the host platform's spelling: a drive
 * letter or UNC prefix on Windows, a leading slash elsewhere.
 * @param path - candidate path.
 */
export declare function isAbsoluteFolderPath(path: string): boolean;
/**
 * Tolerant reader: shape-normalizes whatever was on disk and drops unusable
 * workspaces, folders and roots instead of throwing. A missing, non-mapping or
 * unknown-version document yields the empty document.
 * @param raw - parsed JSON value.
 */
export declare function parseFoldersDocument(raw: unknown): FoldersDocument;
/**
 * Strict writer-side validation. Every rule is enforced and the first problem
 * throws, so the PUT route rejects instead of persisting a half-valid file.
 * @param raw - parsed JSON value from the request body.
 * @returns the normalized document to save.
 * @throws when version, workspace ids, folder paths, duplicates or the root
 * membership are wrong.
 */
export declare function validateFoldersDocument(raw: unknown): FoldersDocument;
/**
 * Read + tolerate the overlay file. A missing or unreadable file yields the
 * empty document: folders are a convenience, and a broken sidecar must not take
 * the tree down with it.
 * @param path - overlay file path.
 */
export declare function readFoldersDocument(path: string): Promise<FoldersDocument>;
/**
 * Atomically replace the overlay file: write a same-directory temp file,
 * fsync it, then rename over the target. A crash never leaves a torn JSON at
 * the real path (readers see either the old or the new file).
 * @param path - target file path.
 * @param document - validated document to persist.
 */
export declare function writeFoldersDocument(path: string, document: FoldersDocument): Promise<void>;
/** Connection record of the remote-ssh plugin at a mirror root. */
export declare const REMOTE_MARKER_FILE_NAME = ".remote-ssh.json";
/** The subset of that record this plugin needs to reproduce it. */
export interface RemoteMarker {
    readonly profileId?: string;
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly keyPath?: string;
    readonly proxyJump?: string;
    readonly remotePath: string;
}
/**
 * Read the remote-ssh connection record of a directory.
 * @param dir - directory that may hold the record (a mirror root, usually).
 * @returns the record, or null when the directory is not remote-backed.
 */
export declare function readRemoteMarker(dir: string): Promise<RemoteMarker | null>;
/**
 * Join a remote path with a mirror-relative subpath.
 *
 * The remote path is POSIX (the server's), so this never uses `node:path`:
 * a Windows host would otherwise hand `/home/me/proj\data` to the remote shell.
 * @param remotePath - the workspace's remote root (`~`, `~/proj`, `/srv/proj`).
 * @param relativePath - subpath inside the mirror, either separator style.
 * @returns the remote counterpart, or null for an empty or escaping subpath.
 */
export declare function remoteSubpath(remotePath: string, relativePath: string): string | null;
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
export declare function ensureRemoteMarker(workspacePath: string, folderPath: string): Promise<{
    marked: boolean;
    remotePath?: string;
}>;

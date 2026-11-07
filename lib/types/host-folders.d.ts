import { type FoldersDocument } from './core/folders.ts';
/** File name of the folder sidecar (also the stable error-text prefix). */
export declare const FOLDERS_FILE_NAME = "workspace-groups.folders.json";
/** Hard limits enforced at the write boundary. */
export declare const FOLDERS_PER_WORKSPACE_LIMIT = 32;
export declare const MEMBERS_PER_WORKSPACE_LIMIT = 16;
export declare const WORKSPACE_ID_LIMIT = 200;
export declare const FOLDER_PATH_LIMIT = 1024;
export declare const REMOTE_PATH_LIMIT = 1024;
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
 * The path is hardcoded in that plugin (it does NOT read `DSH_HOME`), so it is
 * hardcoded here too. A custom `DSH_HOME` therefore makes PATH-BASED detection
 * unreliable: `remoteMirrorBaseDiagnostic()` surfaces that explicitly, and
 * write operations must still treat the SSH catalogue as authoritative.
 */
export declare function defaultRemoteMirrorBase(): string;
/** Mirror base plus a non-fatal diagnostic when it cannot be trusted. */
export interface RemoteMirrorBaseDiagnostic {
    readonly base: string;
    readonly warning?: string;
}
/**
 * Report a mismatch between `$DSH_HOME` and the hard-coded remote-ssh mirror
 * root. Silently returning a wrong base used to disable remote/local detection
 * with no symptom at all; the UI now shows `warning` instead.
 */
export declare function remoteMirrorBaseDiagnostic(): RemoteMirrorBaseDiagnostic;
/**
 * Absolute-path test for SIDECAR data: delegated to `core/folders.ts` so the
 * host validator and the browser tree use exactly one spelling-based rule.
 * A sidecar may hold Windows and POSIX spellings at once (WSL, synced config,
 * a Windows client with a POSIX mirror), so `process.platform` must not decide.
 * @param path - candidate path.
 */
export declare function isAbsoluteFolderPath(path: string): boolean;
/** Validate a local path for the read-only remote hint endpoint. */
export declare function validateRemoteHintPath(path: unknown): string;
/**
 * Presence-only safety hint, never a trusted SSH connection or registration.
 * lstat also treats dangling symlinks as hints without reading their targets.
 * Only ENOENT is ignored: permissions and all other inspection failures must
 * prevent callers from silently falling back to local operations.
 */
export declare function hasRemoteMarkerHint(path: string): Promise<boolean>;
/**
 * Tolerant reader: shape-normalizes whatever was on disk and drops unusable
 * workspaces, folders and roots instead of throwing. A missing, non-mapping or
 * unknown-version document yields the empty document — but ONLY when the file
 * could actually be read and parsed; `readFoldersState` is responsible for
 * reporting a read/parse failure as an error.
 * @param raw - parsed JSON value.
 */
export declare function parseFoldersDocument(raw: unknown): FoldersDocument;
/**
 * Strict writer-side validation. Every rule is enforced and the first problem
 * throws, so the PUT route rejects instead of persisting a half-valid file.
 * @param raw - parsed JSON value from the request body.
 * @param remoteBase - mirror root used to constrain remote members.
 * @returns the normalized document to save.
 * @throws when version, workspace ids, folder paths, duplicates, the root
 * membership or cross-workspace references are wrong.
 */
export declare function validateFoldersDocument(raw: unknown, remoteBase?: string): FoldersDocument;
/** Exact state of the sidecar, including the revision used by `If-Match`. */
export interface FoldersState {
    readonly document: FoldersDocument;
    /** First 16 hex chars of sha256 over the exact on-disk bytes; '' when missing. */
    readonly revision: string;
    /** True when the file does not exist (a legitimate empty overlay). */
    readonly missing: boolean;
    readonly schemaWarning?: string;
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
export declare function readFoldersState(path: string): Promise<FoldersState>;
/**
 * Legacy tolerant reader kept for the verifier scripts. New code must use
 * `readFoldersState` so a read failure is not mistaken for an empty overlay.
 * @param path - overlay file path.
 */
export declare function readFoldersDocument(path: string): Promise<FoldersDocument>;
/**
 * Atomically replace the overlay file. Kept as the public single-document
 * writer used by the verifier scripts; the HTTP route uses
 * `replaceFoldersDocument` instead, which adds the CAS guard.
 * @param path - target file path.
 * @param document - validated document to persist.
 */
export declare function writeFoldersDocument(path: string, document: FoldersDocument): Promise<void>;
/** Outcome of a guarded replace. */
export type FoldersReplaceResult = {
    readonly ok: true;
    readonly revision: string;
} | {
    readonly ok: false;
    readonly kind: 'conflict';
    readonly state: FoldersState;
};
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
export declare function replaceFoldersDocument(path: string, expectedRevision: string | undefined, document: FoldersDocument): Promise<FoldersReplaceResult>;
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
export declare function remoteSubpath(remotePath: string, relativePath: string): string | null;

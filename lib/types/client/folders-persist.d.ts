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
import { type FoldersDocument } from '../core/folders.ts';
/** Host route holding the folder overlay. */
export declare const FOLDERS_ROUTE = "/workspace-groups/folders";
/** One successful read: the overlay plus the mirror base the host reported. */
export interface FoldersSnapshot {
    readonly document: FoldersDocument;
    /**
     * Local mirror root of the remote-ssh plugin, when the host named one.
     * Workspaces whose directory lives below it are remote mirrors, so their extra
     * folders must be subdirectories of that same mirror.
     */
    readonly remoteBase?: string;
}
/**
 * Fetch the stored folder overlay.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns the overlay plus the reported mirror base; the empty document on any
 * failure.
 */
export declare function loadFolders(fetchImpl?: typeof fetch): Promise<FoldersSnapshot>;
/**
 * Store the whole folder overlay.
 *
 * Unlike the tab strip this does NOT swallow failures: folder edits are explicit
 * row/dialog actions, so the caller turns a rejection into a toast instead of
 * leaving the user with a row that silently forgot its folder.
 * @param document - the client's current document.
 * @param fetchImpl - fetch implementation (injectable for tests).
 */
export declare function saveFolders(document: FoldersDocument, fetchImpl?: typeof fetch): Promise<void>;
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
export declare function ensureRemoteFolderMarker(workspacePath: string, folderPath: string, fetchImpl?: typeof fetch): Promise<boolean>;

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
/**
 * Fetch the stored folder overlay.
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns the document; the empty document on any failure.
 */
export declare function loadFolders(fetchImpl?: typeof fetch): Promise<FoldersDocument>;
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

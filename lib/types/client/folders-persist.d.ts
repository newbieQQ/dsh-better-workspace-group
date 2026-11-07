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
import { type FoldersDocument } from '../core/folders.ts';
/** Host route holding the folder overlay. */
export declare const FOLDERS_ROUTE = "/workspace-groups/folders";
/** One successful read: the overlay plus the host's diagnostics and revision. */
export interface FoldersSnapshot {
    readonly document: FoldersDocument;
    /**
     * Local mirror root of the remote-ssh plugin, when the host named one.
     * Workspaces whose directory lives below it are remote mirrors, so their extra
     * folders must be subdirectories of that same mirror.
     */
    readonly remoteBase?: string;
    /** Set when `$DSH_HOME` and the hard-coded remote-ssh mirror root disagree. */
    readonly remoteBaseWarning?: string;
    /** Set when the sidecar uses a schema version this build cannot safely edit. */
    readonly schemaWarning?: string;
    /** Content hash of the sidecar this snapshot was built from (ETag value). */
    readonly revision?: string;
}
/** Result of a read. `ok: false` means "do not render or write anything". */
export type FoldersLoadResult = {
    readonly ok: true;
    readonly snapshot: FoldersSnapshot;
} | {
    readonly ok: false;
    readonly error: string;
};
/** A 409: the caller's baseline is stale; `current` is the server's document. */
export declare class FoldersConflictError extends Error {
    readonly current: FoldersSnapshot;
    constructor(current: FoldersSnapshot, message?: string);
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
export declare function parseFoldersSnapshot(body: unknown): FoldersSnapshot | null;
/**
 * Fetch the stored folder overlay.
 *
 * @param fetchImpl - fetch implementation (injectable for tests).
 * @returns `{ ok: true, snapshot }` or `{ ok: false, error }`. NEVER an empty
 * document on failure: the caller must disable edits instead.
 */
export declare function loadFolders(fetchImpl?: typeof fetch): Promise<FoldersLoadResult>;
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
export declare function saveFolders(document: FoldersDocument, expectedRevision: string | undefined, fetchImpl?: typeof fetch): Promise<string>;

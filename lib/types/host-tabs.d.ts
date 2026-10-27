/** One persisted tab. */
export interface PersistedTab {
    /** Session id the tab points at. */
    readonly sessionId: string;
    /** Arrival key (React list identity). */
    readonly order: number;
}
/** The persisted document. */
export interface TabsDocument {
    /** Shape version; a mismatch discards the file rather than guessing. */
    readonly version: 1;
    /** Arrival counter, kept ahead of every tab's own order. */
    readonly order: number;
    readonly tabs: readonly PersistedTab[];
}
/** Default location: `$DSH_HOME/workspace-groups.tabs.json`. */
export declare function defaultTabsPath(): string;
/**
 * Parse + shape-validate a tabs document.
 *
 * Tolerant on purpose: this file is a display cache, so a malformed one must
 * read as "no tabs" rather than break the strip. Individual bad rows are dropped
 * and the rest kept. Unknown fields (such as the `sessionKey` an older build
 * wrote) are ignored, so an existing file keeps working across the change.
 *
 * @param raw - parsed JSON value.
 * @returns the normalized document, or null when it is unusable.
 */
export declare function parseTabsDocument(raw: unknown): TabsDocument | null;
/**
 * Read the tabs document.
 *
 * A missing file is not an error (first run). A corrupt one is reported as null
 * so the caller starts empty, and the next write repairs the file.
 *
 * @param path - sidecar path.
 * @returns the document, or null when absent/unusable.
 */
export declare function readTabsDocument(path: string): Promise<TabsDocument | null>;
/**
 * Write the tabs document atomically.
 * @param path - sidecar path.
 * @param document - document to store.
 */
export declare function writeTabsDocument(path: string, document: TabsDocument): Promise<void>;
/**
 * Build the document to persist.
 * @param state - the client's current strip and its arrival counter.
 * @returns the document to write.
 */
export declare function documentForTabs(state: {
    order: number;
    tabs: readonly PersistedTab[];
}): TabsDocument;

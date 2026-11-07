/**
 * Pure helpers for comparing remote directory paths.
 *
 * Kept out of `FoldersDialog.tsx` so the alias-vs-absolute rule can be unit
 * tested without mounting React. The remote browser always returns an ABSOLUTE
 * path (`pwd -P`), while the SSH catalogue may store `~/projects/app`; comparing
 * those two spellings directly is what used to make every browsed subdirectory
 * look like a brand-new cloud workspace.
 */
/** Unify separators and drop trailing slashes so two spellings compare equal. */
export declare function normalizeRemotePath(value: string): string;
/**
 * Relative path of `picked` inside `root`: '' for the root itself, null outside.
 * `root` must be an ABSOLUTE remote path; an alias can never be matched
 * reliably against the absolute path the remote browser returns, so we refuse
 * to guess rather than misclassifying a child folder.
 */
export declare function subfolderOf(root: string | null, picked: string): string | null;

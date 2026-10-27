/**
 * Attribute the tree puts on every row the branch should connect. */
export declare const BRANCH_ROW_ATTRIBUTE = "data-wg-branch-row";
/**
 * Attribute marking the row the stem should grow to.
 *
 * Only the DEEPEST row gets this (the session). Its ancestors — the project and
 * the category that contain it — deliberately do NOT, because a session belongs
 * to both and marking all three would make "which row is active?" ambiguous.
 * When several rows do carry it, the deepest (last in document order) wins.
 */
export declare const BRANCH_ACTIVE_ATTRIBUTE = "data-wg-branch-active";
/** Row kind marker: a group boundary kinks the stem. */
export declare const BRANCH_GROUP_ATTRIBUTE = "data-wg-branch-group";
/**
 * Render the branch for the rows currently inside `scope`.
 * @param props - the element to measure, and whether the open session is working.
 * @returns the SVG overlay, or null until at least one row is measured.
 */
export declare function FlowerBranch({ scope, spinning }: {
    scope: HTMLElement | null;
    spinning: boolean;
}): import("react").JSX.Element | null;

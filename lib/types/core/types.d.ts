/**
 * Shared config types for @dsh-xhl/workspace-groups. Pure types (zero runtime
 * deps) so both halves — the node half (sidecar YAML reading) and the
 * browser half (tree derivation) — compile against the same contract.
 */
/** One classification rule: any rule that matches places the workspace in the category. */
export interface GroupRule {
    /** Absolute path prefix match (normalized, case-sensitive). */
    pathPrefix?: string;
    /** Case-insensitive substring match against the workspace display title. */
    nameContains?: string;
    /** Case-insensitive substring match against the workspace directory basename. */
    basenameContains?: string;
    /** Exact absolute path match (normalized). */
    pathExact?: string;
}
/** One category folder in the sidebar tree. */
export interface GroupCategory {
    /** Display label of the category folder. */
    name: string;
    /** Rules; a workspace is classified here when ANY rule matches. */
    rules: GroupRule[];
}
/** The full sidecar configuration (mirrors workspace-groups.yaml). */
export interface GroupsConfig {
    /** Category folders, in render order. First match wins. */
    categories: GroupCategory[];
    /**
     * Runtime grouping overlay (manual groups + per-workspace overrides).
     * Optional: the YAML file itself never carries it — the host GET route
     * merges it from `workspace-groups.manual.json`, and the browser PUT route
     * replaces it whole.
     */
    manual?: ManualGroups;
}
/**
 * Runtime-managed grouping overlay: groups created in the sidebar UI plus
 * per-workspace category overrides and user-controlled ordering. Owned by the
 * plugin (JSON sidecar, `$DSH_HOME/workspace-groups.manual.json`), never
 * written back into the operator YAML.
 *
 * All new fields are optional for backward compatibility (files written by
 * older plugin versions keep working); rendering falls back to sensible
 * defaults when they are absent.
 */
export interface ManualGroups {
    /**
     * Manually created category folder names. These have no rules — they render
     * even while empty (a new group appears before anything is dragged into
     * it) and hold only workspaces assigned to them.
     */
    categories: string[];
    /**
     * Per-workspace category override, keyed by workspace id. Value is a
     * category display name (rule or manual), or `null` to force the workspace
     * into the uncategorized bucket even when a rule would match. An absent
     * key means "classify by rules".
     */
    assignments: Record<string, string | null>;
    /**
     * Display order of all category keys (rule display names + manual names).
     * The uncategorized bucket is never listed — it always renders last.
     * Absent = rule categories first (YAML order), manual groups appended in
     * creation order.
     */
    categoryOrder?: string[];
    /**
     * Per-category ordered workspace ids (user drag-reorder within a group).
     * Keyed by category display name; absent key = host registration order.
     */
    workspaceOrder?: Record<string, string[]>;
    /**
     * Rule category rename overrides: original YAML rule category name →
     * display name (UI rename of a rule group). Rules still classify by the
     * original name; only the rendered label/keys change.
     */
    renamed?: Record<string, string>;
    /**
     * Rule category original names hidden by a UI delete. Hidden rules are
     * inert: workspaces matching them become top-level (ungrouped).
     */
    hidden?: string[];
}
/**
 * Legacy label of the fallback bucket. The top-level (ungrouped) concept
 * replaced the rendered "未分类" bucket: workspaces in no group render as
 * top-level rows beside the group folders. The constant survives for data
 * compatibility (reserved name, assignment null marker).
 */
export declare const UNCATEGORIZED_LABEL = "\u672A\u5206\u7C7B";
/**
 * Reserved key under `workspaceOrder` holding the manual order of TOP-LEVEL
 * (ungrouped) project rows. Distinct from any real group display name (a group
 * may not be named this), so it can never collide; the top-level list's order
 * is preserved exactly like a group's, and top-level rows can be reordered by
 * dragging.
 */
export declare const TOP_LEVEL_ORDER_KEY = "__topLevel__";
/** Normalize a path for prefix matching: trailing slashes stripped. */
export declare function normalizePath(path: string): string;

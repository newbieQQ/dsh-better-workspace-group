/**
 * Recognising the Host's own default workspace ("默认工作区").
 *
 * The workspace snapshot carries no `isDefault` flag, so we mirror the two
 * Host-owned signals here (the registry title and the Host's own directory
 * layout); the constants live in the workspace-controller package, which this
 * plugin must not import at runtime because it is a client bundle.
 *
 * The PATH is the primary signal: `<Documents>/deepseek-harness/default-workspace`
 * still identifies the default workspace after the user renames it, and a
 * user-created directory that merely happens to be called "default-workspace"
 * somewhere else on disk is NOT the Host default workspace. The TITLE is only
 * a fallback for snapshots that carry no usable path at all.
 *
 * (An earlier version checked the title FIRST and returned true immediately.
 * That silently re-classified any workspace the user renamed to
 * "default-workspace" as the Host default, hiding it from the sidebar, and
 * contradicted the guarantee in the comment above.)
 */
/** Directory name the Host uses for its default workspace (host mirror). */
export declare const DEFAULT_WORKSPACE_TITLE = "default-workspace";
/** The fields the identification needs from a workspace snapshot. */
export interface DefaultWorkspaceIdentity {
    /** Registry title (`WorkspaceView.title`). */
    title?: string | undefined;
    /** Absolute workspace directory (`WorkspaceView.path`). */
    path?: string | undefined;
}
/**
 * Whether a workspace snapshot is the Host's default workspace.
 * @param workspace - workspace snapshot (path is primary, title is a fallback
 * for path-less snapshots).
 */
export declare function isDefaultWorkspace(workspace: DefaultWorkspaceIdentity): boolean;

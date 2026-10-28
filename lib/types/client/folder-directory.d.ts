export interface RemoteFolderWorkspace {
    mirrorPath: string;
    remotePath: string;
    profileId: string;
}
/** Resolve against the SSH plugin's registered mirrors, not copied marker files. */
export declare function remoteFolderWorkspace(path: string, remoteBase: string | null, fetchImpl?: typeof fetch): Promise<RemoteFolderWorkspace | null>;
/** Single-segment names match DSH createDirectory(path, name). */
export declare function validateFolderName(raw: string): string;
export declare function createWorkspaceDirectory(parent: string, rawName: string, remoteBase: string | null, createLocal: (path: string, name: string) => Promise<string>, fetchImpl?: typeof fetch): Promise<{
    path: string;
    remote: boolean;
}>;

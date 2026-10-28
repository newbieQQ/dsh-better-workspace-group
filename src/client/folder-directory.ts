/** One directory operation for local DSH and optional remote-ssh workspaces.
 * Never send remote writes through the sidebar route: without its SSH interceptor
 * that route can create a LOCAL directory instead. Use the SSH-owned API instead.
 */
import { isUnderBase, joinSubpath, samePath } from '../core/folders.ts'

export interface RemoteFolderWorkspace {
  mirrorPath: string
  remotePath: string
  profileId: string
}

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject : undefined
}
function message(value: JsonObject | undefined): string {
  const error = value?.error
  return typeof error === 'string' ? error
    : typeof object(error)?.message === 'string' ? String(object(error)?.message)
      : typeof value?.stderr === 'string' && value.stderr !== '' ? value.stderr
        : 'Remote SSH request failed'
}

async function rpc(method: string, body: JsonObject, fetchImpl: typeof fetch): Promise<JsonObject | null> {
  const response = await fetchImpl(`/remote-ssh/api/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(30000),
  })
  // Only catalog absence denotes an optional plugin not installed/running.
  if (response.status === 404 && method === 'listWorkspaces') return null
  if (!response.ok) throw new Error(`Remote SSH ${method}: HTTP ${response.status}`)
  const envelope = object(await response.json())
  const value = object(envelope?.value)
  if (envelope?.ok !== true || value?.ok !== true) throw new Error(message(value ?? envelope))
  return value
}

/** A marker is only a refusal hint, never authority to execute remote commands. */
async function refuseMarkedLocalPath(path: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(`/workspace-groups/remote-hint?path=${encodeURIComponent(path)}`, {
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Cannot verify local directory: HTTP ${response.status}`)
  const body = object(await response.json())
  if (typeof body?.remoteHint !== 'boolean') throw new Error('Invalid directory safety response')
  if (body.remoteHint) throw new Error('SSH marker detected but no active registered remote workspace; refusing local operation')
}

/** Resolve against the SSH plugin's registered mirrors, not copied marker files. */
export async function remoteFolderWorkspace(
  path: string, remoteBase: string | null, fetchImpl: typeof fetch = fetch,
): Promise<RemoteFolderWorkspace | null> {
  const value = await rpc('listWorkspaces', {}, fetchImpl)
  const knownMirror = remoteBase !== null && isUnderBase(path, remoteBase)
  if (value === null) {
    if (knownMirror) throw new Error('SSH plugin is unavailable; refusing a local operation in a remote mirror')
    await refuseMarkedLocalPath(path, fetchImpl)
    return null
  }
  if (!Array.isArray(value.workspaces)) throw new Error('Invalid SSH workspace catalog')
  const matches: RemoteFolderWorkspace[] = []
  for (const raw of value.workspaces) {
    const row = object(raw)
    if (!row || typeof row.mirrorPath !== 'string' || typeof row.remotePath !== 'string'
      || typeof row.profileId !== 'string' || !row.mirrorPath || !row.remotePath || !row.profileId) {
      throw new Error('Invalid SSH workspace entry')
    }
    if (samePath(path, row.mirrorPath) || isUnderBase(path, row.mirrorPath)) {
      matches.push({ mirrorPath: row.mirrorPath, remotePath: row.remotePath, profileId: row.profileId })
    }
  }
  if (matches.length > 1) throw new Error('Overlapping SSH workspaces are not supported safely')
  if (matches.length === 1) return matches[0]!
  if (knownMirror) throw new Error('Remote mirror is not registered with the SSH plugin')
  await refuseMarkedLocalPath(path, fetchImpl)
  return null
}

/** Single-segment names match DSH createDirectory(path, name). */
export function validateFolderName(raw: string): string {
  const name = raw.trim()
  if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f]/u.test(name)) {
    throw new Error('Enter a single folder name, not an absolute path or nested path')
  }
  return name
}

export async function createWorkspaceDirectory(
  parent: string, rawName: string, remoteBase: string | null,
  createLocal: (path: string, name: string) => Promise<string>, fetchImpl: typeof fetch = fetch,
): Promise<{ path: string; remote: boolean }> {
  const name = validateFolderName(rawName)
  const path = joinSubpath(parent, name)
  if (path === null) throw new Error('Invalid folder name')
  const remote = await remoteFolderWorkspace(parent, remoteBase, fetchImpl)
  if (!remote) return { path: await createLocal(parent, name), remote: false }
  // Names with shell expansions are rejected defensively for older SSH wrappers.
  if (/[\u0000-\u001f`$"\\]/u.test(name)) throw new Error('Unsupported remote folder name')
  const normalizedParent = parent.trim().replace(/\\/gu, '/').replace(/\/+$/u, '')
  const normalizedRoot = remote.mirrorPath.trim().replace(/\\/gu, '/').replace(/\/+$/u, '')
  const suffix = normalizedParent.slice(normalizedRoot.length).replace(/^\/+/, '')
  if (suffix.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid mirror path')
  const root = remote.remotePath.replace(/\/+$/u, '')
  const remotePath = `${root}/${suffix ? `${suffix}/` : ''}${name}`
  await rpc('mkdir', { profileId: remote.profileId, path: remotePath }, fetchImpl)
  return { path, remote: true }
}

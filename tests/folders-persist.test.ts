/**
 * Client persistence contract: a failed read must never become a writable
 * empty document, every write must carry an If-Match revision, and a 409 must
 * surface the server's newest snapshot instead of silently retrying.
 */
import { describe, expect, it } from 'vitest'
import {
  FoldersConflictError,
  loadFolders,
  parseFoldersSnapshot,
  saveFolders,
} from '../src/client/folders-persist.ts'
import type { FoldersDocument } from '../src/core/folders.ts'

type FetchCall = { url: string; init: RequestInit | undefined }

function fakeFetch(body: unknown, status = 200): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const response = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(response)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const document: FoldersDocument = {
  version: 1,
  workspaces: { 'project-a': { folders: ['C:\\work\\extra'] } },
}

describe('loadFolders', () => {
  it('returns a snapshot with the host revision on success', async () => {
    const { fetchImpl } = fakeFetch({ version: 1, workspaces: {}, remoteBase: '/mirror', revision: 'abc123' })
    const result = await loadFolders(fetchImpl)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.revision).toBe('abc123')
    expect(result.snapshot.remoteBase).toBe('/mirror')
  })

  it('fails closed on a network error instead of returning an empty document', async () => {
    const fetchImpl = (() => Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch
    const result = await loadFolders(fetchImpl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('ECONNRESET')
  })

  it('fails closed on a 500 instead of returning an empty document', async () => {
    const { fetchImpl } = fakeFetch({ error: 'EACCES' }, 500)
    const result = await loadFolders(fetchImpl)
    expect(result.ok).toBe(false)
  })

  it('fails closed on malformed JSON', async () => {
    const fetchImpl = (() => Promise.resolve({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') },
    })) as unknown as typeof fetch
    const result = await loadFolders(fetchImpl)
    expect(result.ok).toBe(false)
  })
})

describe('parseFoldersSnapshot', () => {
  it('keeps an entry whose folders key is missing but that has members', () => {
    const snapshot = parseFoldersSnapshot({
      version: 1,
      revision: 'r1',
      workspaces: {
        'project-a': {
          members: [{ path: '/srv/mirror/app', workspaceId: 'ws-app', kind: 'remote' }],
        },
      },
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot!.document.workspaces['project-a']?.members).toHaveLength(1)
  })

  it('keeps an entry that carries only a root', () => {
    const snapshot = parseFoldersSnapshot({
      version: 1,
      workspaces: { 'project-a': { root: '/work/extra' } },
    })
    expect(snapshot!.document.workspaces['project-a']?.root).toBe('/work/extra')
  })

  it('never returns a writable empty document for an unknown schema', () => {
    const snapshot = parseFoldersSnapshot({ version: 2, workspaces: {}, revision: 'r9' })
    expect(snapshot!.document.workspaces).toEqual({})
    expect(snapshot!.schemaWarning).toContain('version 2')
    expect(snapshot!.revision).toBe('r9')
  })
})

describe('saveFolders', () => {
  it('sends If-Match and returns the new revision', async () => {
    const { fetchImpl, calls } = fakeFetch({ version: 1, workspaces: {}, revision: 'new-rev' })
    const revision = await saveFolders(document, 'old-rev', fetchImpl)
    expect(revision).toBe('new-rev')
    expect(calls[0]!.init?.method).toBe('PUT')
    expect((calls[0]!.init?.headers as Record<string, string>)['If-Match']).toBe('old-rev')
    expect((calls[0]!.init as RequestInit & { keepalive?: boolean }).keepalive).toBeUndefined()
  })

  it('throws FoldersConflictError with the server snapshot on 409', async () => {
    const serverDocument = { version: 1, workspaces: { other: { folders: ['/elsewhere'] } }, revision: 'server-rev' }
    const { fetchImpl } = fakeFetch(serverDocument, 409)
    await expect(saveFolders(document, 'stale-rev', fetchImpl)).rejects.toMatchObject({
      name: 'FoldersConflictError',
    })
    try {
      await saveFolders(document, 'stale-rev', fetchImpl)
    } catch (error) {
      expect(error).toBeInstanceOf(FoldersConflictError)
      expect((error as FoldersConflictError).current.revision).toBe('server-rev')
      expect((error as FoldersConflictError).current.document.workspaces.other).toBeDefined()
    }
  })

  it('throws a plain error on a non-409 failure', async () => {
    const { fetchImpl } = fakeFetch({ error: 'disk full' }, 500)
    await expect(saveFolders(document, 'r1', fetchImpl)).rejects.toThrow('PUT /workspace-groups/folders: 500')
  })
})

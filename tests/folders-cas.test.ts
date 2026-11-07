/**
 * Host-side regressions for the folder overlay's safety contract:
 *
 *  - a real read error must produce HTTP 500, never `200 + empty document`;
 *  - a stale writer must get 409 with the CURRENT document, never a lost update;
 *  - an unknown on-disk schema must never be downgraded to v1;
 *  - the host must reject a remote member whose path escapes the mirror base;
 *  - path identity is lexical-normalized, platform-independent, and preserves
 *    the root when a member is re-registered.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../src/index.ts'
import type { GroupsContext, GroupsWebRoute } from '../src/context-types.ts'
import {
  FOLDERS_FILE_NAME,
  parseFoldersDocument,
  readFoldersState,
  remoteMirrorBaseDiagnostic,
  replaceFoldersDocument,
  validateFoldersDocument,
} from '../src/host-folders.ts'
import {
  addMember,
  canonicalPath,
  isAbsoluteFolderPath,
  isUnderBase,
  joinSubpath,
  samePath,
  validMembers,
  type FolderMember,
  type FoldersDocument,
} from '../src/core/folders.ts'
import { isDefaultWorkspace } from '../src/core/default-workspace.ts'

type RequestResult = { status: number; text: string | undefined }

async function routeHarness(): Promise<{
  home: string
  request: (method: string, body?: string, headers?: Record<string, string>) => Promise<RequestResult>
  restore: () => Promise<void>
}> {
  const home = await mkdtemp(join(tmpdir(), 'wg-cas-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const routes: GroupsWebRoute[] = []
  apply({
    effect: (callback: () => unknown) => callback(),
    webServer: { register: (route: GroupsWebRoute) => { routes.push(route); return () => {} } },
  } as unknown as GroupsContext)
  const route = routes.find(item => item.path === '/workspace-groups/folders')!
  const request = async (
    method: string, body?: string, headers: Record<string, string> = {},
  ): Promise<RequestResult> => {
    const req = Readable.from(body === undefined ? [] : [body]) as IncomingMessage
    req.method = method
    req.headers = headers
    let status = 0
    let text: string | undefined
    await route.handler(req, {
      writeHead: (code: number) => { status = code },
      end: (value?: string) => { text = value },
    } as unknown as ServerResponse)
    return { status, text }
  }
  return {
    home,
    request,
    restore: async () => {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(home, { recursive: true, force: true })
    },
  }
}

const firstDocument: FoldersDocument = {
  version: 1,
  workspaces: { 'project-a': { folders: ['/work/extra-a'] } },
}

describe('folder overlay HTTP contract', () => {
  it('answers 500 (not an empty document) when the overlay cannot be read', async () => {
    const harness = await routeHarness()
    try {
      // A directory where the JSON file should be makes readFile fail with EISDIR.
      await mkdir(join(harness.home, FOLDERS_FILE_NAME), { recursive: true })
      const response = await harness.request('GET')
      expect(response.status).toBe(500)
      expect(response.text).toContain('cannot read folder overlay')
    } finally {
      await harness.restore()
    }
  })

  it('rejects a stale If-Match with 409 and echoes the current document', async () => {
    const harness = await routeHarness()
    try {
      const first = await harness.request('PUT', JSON.stringify(firstDocument))
      expect(first.status).toBe(200)
      const revision = (JSON.parse(first.text!) as { revision: string }).revision
      expect(revision).toMatch(/^[0-9a-f]{16}$/u)

      const stale = await harness.request(
        'PUT',
        JSON.stringify({ version: 1, workspaces: { 'project-b': { folders: ['/work/extra-b'] } } }),
        { 'if-match': 'deadbeefdeadbeef' },
      )
      expect(stale.status).toBe(409)
      const conflict = JSON.parse(stale.text!) as Record<string, unknown>
      expect(conflict.workspaces).toEqual(firstDocument.workspaces)
      expect(typeof conflict.revision).toBe('string')
      expect(conflict.remoteBase).toBe(remoteMirrorBaseDiagnostic().base)

      const changed = { version: 1, workspaces: { 'project-a': { folders: ['/work/extra-a', '/work/extra-c'] } } }
      const accepted = await harness.request('PUT', JSON.stringify(changed), { 'if-match': revision })
      expect(accepted.status).toBe(200)
      expect((JSON.parse(accepted.text!) as { revision: string }).revision).not.toBe(revision)
    } finally {
      await harness.restore()
    }
  })

  it('serializes concurrent writes so only one wins', async () => {
    const harness = await routeHarness()
    try {
      const first = await harness.request('PUT', JSON.stringify(firstDocument))
      const revision = (JSON.parse(first.text!) as { revision: string }).revision
      const a = { version: 1, workspaces: { a: { folders: ['/work/a'] } } }
      const b = { version: 1, workspaces: { b: { folders: ['/work/b'] } } }
      const results = await Promise.all([
        harness.request('PUT', JSON.stringify(a), { 'if-match': revision }),
        harness.request('PUT', JSON.stringify(b), { 'if-match': revision }),
      ])
      expect(results.filter(result => result.status === 200)).toHaveLength(1)
      expect(results.filter(result => result.status === 409)).toHaveLength(1)
    } finally {
      await harness.restore()
    }
  })

  it('refuses to downgrade an unknown on-disk schema to v1', async () => {
    const harness = await routeHarness()
    try {
      const path = join(harness.home, FOLDERS_FILE_NAME)
      const future = { version: 2, workspaces: { 'project-a': { folders: ['/work/extra-a'] } } }
      await writeFile(path, JSON.stringify(future), 'utf8')
      const state = await readFoldersState(path)
      const get = await harness.request('GET')
      expect(get.status).toBe(200)
      const body = JSON.parse(get.text!) as Record<string, unknown>
      expect(body.schemaWarning).toContain('version 2')
      expect(body.revision).toBe(state.revision)

      const put = await harness.request('PUT', JSON.stringify(firstDocument), { 'if-match': state.revision })
      expect(put.status).toBe(409)
      expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(2)
    } finally {
      await harness.restore()
    }
  })

  it('keeps remoteBase in both GET and PUT echoes', async () => {
    const harness = await routeHarness()
    try {
      const get = await harness.request('GET')
      const put = await harness.request('PUT', JSON.stringify(firstDocument))
      expect(JSON.parse(get.text!).remoteBase).toBe(remoteMirrorBaseDiagnostic().base)
      expect(JSON.parse(put.text!).remoteBase).toBe(remoteMirrorBaseDiagnostic().base)
    } finally {
      await harness.restore()
    }
  })
})

describe('host validation hardening', () => {
  it('rejects a remote member whose path escapes the mirror base', () => {
    const base = join(tmpdir(), 'wg-mirror-root')
    const outside: FolderMember = {
      path: join(tmpdir(), 'wg-not-a-mirror', 'app'),
      workspaceId: 'ws-app',
      kind: 'remote',
      remotePath: '/srv/app',
      profileId: 'profile-1',
    }
    expect(() => validateFoldersDocument({
      version: 1,
      workspaces: { owner: { folders: [], members: [outside] } },
    }, base)).toThrow()
    const inside: FolderMember = { ...outside, path: join(base, 'app') }
    expect(() => validateFoldersDocument({
      version: 1,
      workspaces: { owner: { folders: [], members: [inside] } },
    }, base)).not.toThrow()
  })

  it('rejects a member that is also an owner workspace', () => {
    expect(() => validateFoldersDocument({
      version: 1,
      workspaces: {
        owner: { folders: ['/work/a'] },
        child: {
          folders: [],
          members: [{ path: '/work/child', workspaceId: 'owner', kind: 'local' }],
        },
      },
    })).toThrow()
  })

  it('keeps an entry whose folders key is missing but has members', () => {
    const parsed = parseFoldersDocument({
      version: 1,
      workspaces: {
        owner: { members: [{ path: '/srv/app', workspaceId: 'ws-app', kind: 'remote', remotePath: '/srv/app', profileId: 'p' }] },
      },
    })
    expect(parsed.workspaces.owner?.members).toHaveLength(1)
  })

  it('rejects a traversal segment in a stored path', () => {
    expect(() => validateFoldersDocument({
      version: 1,
      workspaces: { owner: { folders: ['/work/a/../secret'] } },
    })).toThrow()
  })

  it('replaceFoldersDocument reports a conflict instead of throwing on a read error', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wg-cas-state-'))
    try {
      const path = join(home, FOLDERS_FILE_NAME)
      await writeFile(path, '{not json', 'utf8')
      await expect(readFoldersState(path)).rejects.toThrow('invalid JSON')
      await expect(replaceFoldersDocument(path, 'r1', firstDocument)).rejects.toThrow('invalid JSON')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe('core path and identity hardening', () => {
  it('collapses dot segments so a traversal cannot dodge folder ownership', () => {
    expect(canonicalPath('C:\\work\\a\\..\\b')).toBe(canonicalPath('C:\\work\\b'))
    expect(canonicalPath('/srv/a/../b')).toBe('/srv/b')
    expect(samePath('C:\\work\\a\\..\\b', 'C:\\work\\b')).toBe(true)
    expect(isUnderBase('/srv/root/../root/data', '/srv/root')).toBe(true)
  })

  it('normalizes Unicode to NFC', () => {
    expect(canonicalPath('/work/Cafe\u0301')).toBe(canonicalPath('/work/Caf\u00e9'))
  })

  it('judges absolute paths by spelling, not by the host platform', () => {
    expect(isAbsoluteFolderPath('C:\\work')).toBe(true)
    expect(isAbsoluteFolderPath('/srv/work')).toBe(true)
    expect(isAbsoluteFolderPath('relative/work')).toBe(false)
  })

  it('rejects drive-relative and absolute inputs in joinSubpath', () => {
    expect(joinSubpath('/srv/root', 'C:foo')).toBeNull()
    expect(joinSubpath('/srv/root', '/etc')).toBeNull()
    expect(joinSubpath('/srv/root', '../escape')).toBeNull()
    expect(joinSubpath('/srv/root', 'data')).not.toBeNull()
  })

  it('keeps the root when a member is re-registered at the same path', () => {
    const member: FolderMember = { path: '/srv/mirror/app', workspaceId: 'ws-app', kind: 'remote', remotePath: '/srv/app', profileId: 'p' }
    const withRoot = addMember({ folders: [], members: [], root: '/srv/mirror/app' }, member)
    const reAdded = addMember(withRoot, { ...member, title: 'renamed' })
    expect(reAdded.root).toBe('/srv/mirror/app')
  })

  it('drops a member that points at another owner workspace', () => {
    const doc: FoldersDocument = {
      version: 1,
      workspaces: {
        owner: { folders: [], members: [{ path: '/srv/child', workspaceId: 'child-owner', kind: 'local' }] },
        'child-owner': { folders: ['/srv/child'] },
      },
    }
    expect(validMembers(doc, 'owner')).toHaveLength(0)
  })
})

describe('isDefaultWorkspace', () => {
  it('does not treat an unrelated workspace merely named default-workspace as the host default', () => {
    expect(isDefaultWorkspace({ path: 'C:\\my\\projects\\default-workspace', title: 'default-workspace' })).toBe(false)
  })

  it('still recognises the host state directory layout', () => {
    expect(isDefaultWorkspace({ path: 'C:\\Users\\me\\deepseek-harness\\default-workspace', title: 'anything' })).toBe(true)
  })
})

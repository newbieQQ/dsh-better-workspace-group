/**
 * Per-workspace folder tests: the pure folder logic (path identity, root
 * resolution, cwd ownership, entry editing) plus the host overlay's strict
 * write validation and tolerant read, including the atomic file round-trip.
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { apply } from '../src/index.ts'
import type { GroupsContext, GroupsWebRoute } from '../src/context-types.ts'
import * as hostFolders from '../src/host-folders.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  addFolder,
  effectiveFolders,
  entryFor,
  folderOfCwd,
  removeFolder,
  rootOf,
  samePath,
  setRoot,
  type FoldersDocument,
  type WorkspaceFolderEntry,
} from '../src/core/folders.ts'
import {
  parseFoldersDocument,
  readFoldersDocument,
  validateFoldersDocument,
  writeFoldersDocument,
} from '../src/host-folders.ts'

const BASE = 'C:\\work\\project'
const EXTRA = 'C:\\work\\extra'

describe('deprecated remote marker route', () => {
  it('exports no marker writer or connection record reader', () => {
    expect(hostFolders).not.toHaveProperty('ensureRemoteMarker')
    expect(hostFolders).not.toHaveProperty('readRemoteMarker')
  })

  it('returns 410 without creating or changing markers, while GET/PUT still work', async () => {
    const home = await mkdtemp(join(tmpdir(), 'wg-deprecated-marker-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const routes: GroupsWebRoute[] = []
      apply({
        effect: (callback: () => unknown) => callback(),
        webServer: { register: (route: GroupsWebRoute) => { routes.push(route); return () => {} } },
      } as unknown as GroupsContext)
      const route = routes.find(item => item.path === '/workspace-groups/folders')!
      expect(route).toBeDefined()
      const request = async (method: string, body?: string) => {
        const req = Readable.from(body === undefined ? [] : [body]) as IncomingMessage
        req.method = method
        let status = 0
        let text: string | undefined
        await route.handler(req, {
          writeHead: (code: number) => { status = code },
          end: (value?: string) => { text = value },
        } as unknown as ServerResponse)
        return { status, text }
      }
      const mirror = join(home, 'mirror')
      const existing = join(mirror, 'existing')
      await mkdir(existing, { recursive: true })
      const rootMarker = '{"host":"example.invalid","user":"test","port":22,"remotePath":"/srv/test","writeBack":false}'
      const childMarker = '{"keep":"existing user marker"}\n'
      await writeFile(join(mirror, '.remote-ssh.json'), rootMarker, 'utf8')
      await writeFile(join(existing, '.remote-ssh.json'), childMarker, 'utf8')
      for (const body of [
        JSON.stringify({ workspacePath: mirror, folderPath: join(mirror, 'new', 'nested') }),
        JSON.stringify({ workspacePath: mirror, folderPath: existing }),
        '{invalid json',
        undefined,
      ]) {
        const response = await request('POST', body)
        expect(response.status).toBe(410)
        expect(response.text).toContain('deprecated')
      }
      expect(await readdir(mirror)).toEqual(['.remote-ssh.json', 'existing'])
      expect(await readFile(join(mirror, '.remote-ssh.json'), 'utf8')).toBe(rootMarker)
      expect(await readFile(join(existing, '.remote-ssh.json'), 'utf8')).toBe(childMarker)
      expect(await readdir(home)).toEqual(['mirror'])
      const document = { version: 1, workspaces: { test: { folders: [existing] } } }
      expect((await request('PUT', JSON.stringify(document))).status).toBe(200)
      const response = await request('GET')
      expect(response.status).toBe(200)
      expect(JSON.parse(response.text!)).toEqual({ ...document, remoteBase: hostFolders.defaultRemoteMirrorBase() })

      const hintRoute = routes.find(item => item.path === '/workspace-groups/remote-hint')!
      expect(hintRoute).toBeDefined()
      const hintRequest = async (method: string, path?: string) => {
        let status = 0
        let text: string | undefined
        await hintRoute.handler({
          method,
          url: '/workspace-groups/remote-hint' + (path === undefined ? '' : '?path=' + encodeURIComponent(path)),
        } as IncomingMessage, {
          writeHead: (code: number) => { status = code },
          end: (value?: string) => { text = value },
        } as unknown as ServerResponse)
        return { status, text }
      }
      expect(await hintRequest('GET', join(mirror, 'not-created', 'nested'))).toEqual({ status: 200, text: '{"remoteHint":true}' })
      expect(await hintRequest('GET', existing)).toEqual({ status: 200, text: '{"remoteHint":true}' })
      expect(await hintRequest('GET', home)).toEqual({ status: 200, text: '{"remoteHint":false}' })
      expect(await hintRequest('HEAD', existing)).toEqual({ status: 200, text: undefined })
      expect((await hintRequest('POST', existing)).status).toBe(405)
      for (const path of [undefined, '', 'relative', home + '\u0000', home + 'x'.repeat(1025)]) {
        expect((await hintRequest('GET', path)).status).toBe(400)
      }
      expect(await readFile(join(mirror, '.remote-ssh.json'), 'utf8')).toBe(rootMarker)
      expect(await readFile(join(existing, '.remote-ssh.json'), 'utf8')).toBe(childMarker)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe('remoteSubpath (pure path logic)', () => {
  it('joins remote roots with POSIX separators and rejects traversal', () => {
    expect(hostFolders.remoteSubpath('~', 'data')).toBe('~/data')
    expect(hostFolders.remoteSubpath('/srv/project/', 'a\\b')).toBe('/srv/project/a/b')
    expect(hostFolders.remoteSubpath('/srv/project', '../escape')).toBeNull()
    expect(hostFolders.remoteSubpath('/srv/project', 'a/../b')).toBeNull()
    expect(hostFolders.remoteSubpath('/srv/project', '  ')).toBeNull()
  })
})

describe('samePath', () => {
  it('is case-insensitive for Windows-style paths', () => {
    expect(samePath('C:\\Work\\Project', 'c:\\work\\project')).toBe(true)
  })

  it('ignores trailing separators', () => {
    expect(samePath('C:\\work\\project\\', 'C:\\work\\project')).toBe(true)
    expect(samePath('/home/me/project/', '/home/me/project')).toBe(true)
  })

  it('treats both separators as equal on Windows-style paths', () => {
    expect(samePath('C:/work/project', 'C:\\work\\project')).toBe(true)
  })

  it('distinguishes different POSIX paths case-sensitively', () => {
    expect(samePath('/home/me/Project', '/home/me/project')).toBe(false)
  })
})

describe('effectiveFolders / rootOf / entryFor', () => {
  it('puts the workspace path first', () => {
    expect(effectiveFolders(BASE, undefined)).toEqual([BASE])
    expect(effectiveFolders(BASE, { folders: [EXTRA] })).toEqual([BASE, EXTRA])
  })

  it('drops blank, self-referencing and duplicate extras', () => {
    expect(effectiveFolders(BASE, { folders: ['  ', BASE, 'C:\\WORK\\EXTRA', EXTRA, EXTRA] }))
      .toEqual([BASE, 'C:\\WORK\\EXTRA'])
  })

  it('falls back to the workspace path when no root is stored', () => {
    expect(rootOf(BASE, undefined)).toBe(BASE)
    expect(rootOf(BASE, { folders: [EXTRA] })).toBe(BASE)
  })

  it('returns the stored root', () => {
    expect(rootOf(BASE, { folders: [EXTRA], root: EXTRA })).toBe(EXTRA)
  })

  it('ignores a dangling root that names no effective folder', () => {
    expect(rootOf(BASE, { folders: [EXTRA], root: 'D:\\gone' })).toBe(BASE)
  })

  it('reads entries by workspace id', () => {
    const document: FoldersDocument = { version: 1, workspaces: { 'ws-1': { folders: [EXTRA] } } }
    expect(entryFor(document, 'ws-1')).toEqual({ folders: [EXTRA] })
    expect(entryFor(document, 'ws-2')).toBeUndefined()
  })
})

describe('folderOfCwd', () => {
  const entry: WorkspaceFolderEntry = { folders: [EXTRA, 'C:\\work\\extra\\nested'] }

  it('returns the workspace path for an undefined cwd', () => {
    expect(folderOfCwd(undefined, BASE, entry)).toBe(BASE)
  })

  it('returns the base for a cwd inside the workspace', () => {
    expect(folderOfCwd('C:\\work\\project\\src', BASE, entry)).toBe(BASE)
  })

  it('returns the owning extra folder', () => {
    expect(folderOfCwd('C:\\work\\extra\\src', BASE, entry)).toBe(EXTRA)
  })

  it('returns the most specific folder for a nested folder', () => {
    expect(folderOfCwd('C:\\work\\extra\\nested\\deep', BASE, entry)).toBe('C:\\work\\extra\\nested')
  })

  it('returns the base for a cwd outside every folder', () => {
    expect(folderOfCwd('D:\\elsewhere', BASE, entry)).toBe(BASE)
  })

  it('does not treat a name prefix as an ancestor', () => {
    expect(folderOfCwd('C:\\work\\extrabonus', BASE, entry)).toBe(BASE)
  })

  it('matches the folder itself', () => {
    expect(folderOfCwd('C:\\WORK\\EXTRA', BASE, entry)).toBe(EXTRA)
  })
})

describe('addFolder / removeFolder / setRoot', () => {
  it('adds an extra folder and keeps the root', () => {
    const next = addFolder({ folders: [EXTRA], root: EXTRA }, 'D:\\other')
    expect(next).toEqual({ folders: [EXTRA, 'D:\\other'], root: EXTRA })
  })

  it('is idempotent and trims', () => {
    expect(addFolder({ folders: ['D:\\other'] }, '  D:\\other  ')).toEqual({ folders: ['D:\\other'] })
    expect(addFolder(undefined, EXTRA)).toEqual({ folders: [EXTRA] })
  })

  it('never mutates the input entry', () => {
    const entry: WorkspaceFolderEntry = { folders: [EXTRA] }
    addFolder(entry, 'D:\\other')
    expect(entry).toEqual({ folders: [EXTRA] })
  })

  it('drops a folder and clears a root pointing at it', () => {
    expect(removeFolder({ folders: [EXTRA], root: EXTRA }, EXTRA)).toEqual({ folders: [] })
    expect(removeFolder({ folders: [EXTRA, 'D:\\other'], root: 'D:\\other' }, EXTRA))
      .toEqual({ folders: ['D:\\other'], root: 'D:\\other' })
  })

  it('stores the root only for an extra folder', () => {
    expect(setRoot({ folders: [EXTRA] }, EXTRA)).toEqual({ folders: [EXTRA], root: EXTRA })
    expect(setRoot({ folders: [EXTRA], root: EXTRA }, BASE)).toEqual({ folders: [EXTRA] })
    expect(setRoot(undefined, BASE)).toEqual({ folders: [] })
  })
})

describe('validateFoldersDocument', () => {
  const valid = { version: 1, workspaces: { 'ws-1': { folders: [EXTRA], root: EXTRA } } }

  it('accepts a valid document', () => {
    expect(validateFoldersDocument(valid)).toEqual(valid)
  })

  it('rejects a wrong version', () => {
    expect(() => validateFoldersDocument({ version: 2, workspaces: {} })).toThrow(/version/)
  })

  it('rejects a non-object document', () => {
    expect(() => validateFoldersDocument([])).toThrow(/mapping/)
    expect(() => validateFoldersDocument('nope')).toThrow(/mapping/)
  })

  it('rejects a relative folder path', () => {
    expect(() => validateFoldersDocument({ version: 1, workspaces: { 'ws-1': { folders: ['work'] } } }))
      .toThrow(/absolute/)
  })

  it('rejects case-insensitive duplicates', () => {
    expect(() => validateFoldersDocument({
      version: 1,
      workspaces: { 'ws-1': { folders: [EXTRA, 'c:\\WORK\\extra'] } },
    })).toThrow(/duplicate/)
  })

  it('rejects a root that is not one of the folders', () => {
    expect(() => validateFoldersDocument({
      version: 1,
      workspaces: { 'ws-1': { folders: [EXTRA], root: 'D:\\other' } },
    })).toThrow(/root/)
  })

  it('rejects a NUL byte and an over-long path', () => {
    expect(() => validateFoldersDocument({ version: 1, workspaces: { 'ws-1': { folders: ['C:\\a\u0000b'] } } }))
      .toThrow(/NUL/)
    expect(() => validateFoldersDocument({
      version: 1,
      workspaces: { 'ws-1': { folders: ['C:\\' + 'a'.repeat(1100)] } },
    })).toThrow(/1024/)
  })

  it('rejects more than 32 folders', () => {
    const folders = Array.from({ length: 33 }, (_, index) => `C:\\w\\${index}`)
    expect(() => validateFoldersDocument({ version: 1, workspaces: { 'ws-1': { folders } } }))
      .toThrow(/32/)
  })

  it('rejects an over-long workspace id', () => {
    expect(() => validateFoldersDocument({
      version: 1,
      workspaces: { ['w'.repeat(201)]: { folders: [EXTRA] } },
    })).toThrow(/200/)
  })
})

describe('parseFoldersDocument (tolerant read)', () => {
  it('returns the empty document for junk instead of throwing', () => {
    expect(parseFoldersDocument(undefined)).toEqual({ version: 1, workspaces: {} })
    expect(parseFoldersDocument(null)).toEqual({ version: 1, workspaces: {} })
    expect(parseFoldersDocument([])).toEqual({ version: 1, workspaces: {} })
    expect(parseFoldersDocument({ version: 7, workspaces: {} })).toEqual({ version: 1, workspaces: {} })
  })

  it('drops bad folders, duplicates and dangling roots', () => {
    const parsed = parseFoldersDocument({
      version: 1,
      workspaces: {
        'ws-1': { folders: [EXTRA, 'relative', 42, 'c:\\WORK\\extra', ''] , root: 'D:\\gone' },
        '': { folders: [EXTRA] },
        'ws-2': 'nope',
      },
    })
    expect(parsed).toEqual({ version: 1, workspaces: { 'ws-1': { folders: [EXTRA] } } })
  })

  it('keeps a valid root and tolerates a dangling workspace id', () => {
    const parsed = parseFoldersDocument({
      version: 1,
      workspaces: { 'ws-1': { folders: [EXTRA], root: EXTRA } },
    })
    expect(parsed.workspaces['ws-1']).toEqual({ folders: [EXTRA], root: EXTRA })
  })
})

describe('readFoldersDocument / writeFoldersDocument', () => {
  it('reads a missing file as the empty document', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wg-folders-'))
    try {
      expect(await readFoldersDocument(join(dir, 'missing.json'))).toEqual({ version: 1, workspaces: {} })
      await writeFile(join(dir, 'junk.json'), '{not json', 'utf8')
      expect(await readFoldersDocument(join(dir, 'junk.json'))).toEqual({ version: 1, workspaces: {} })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('round-trips a document through the atomic write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wg-folders-'))
    const path = join(dir, 'nested', 'workspace-groups.folders.json')
    const document: FoldersDocument = { version: 1, workspaces: { 'ws-1': { folders: [EXTRA], root: EXTRA } } }
    try {
      await writeFoldersDocument(path, document)
      expect(await readFoldersDocument(path)).toEqual(document)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

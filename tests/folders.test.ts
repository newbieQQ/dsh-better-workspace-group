/**
 * Per-workspace folder tests: the pure folder logic (path identity, root
 * resolution, cwd ownership, entry editing) plus the host overlay's strict
 * write validation and tolerant read, including the atomic file round-trip.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

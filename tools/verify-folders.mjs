/**
 * Standalone verifier for the per-workspace folder layer.
 *
 * vitest cannot spawn in this sandbox (EPERM), so this script runs the same
 * critical assertions under plain Node 24 type-stripping:
 *   node tools/verify-folders.mjs
 *
 * It imports the pure module (`src/core/folders.ts`) and the host overlay
 * (`src/host-folders.ts`, Node built-ins only), exercises the root/cwd rules and
 * the strict-write / tolerant-read boundary, then prints exactly one line.
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const coreUrl = new URL('../src/core/folders.ts', import.meta.url)
const hostUrl = new URL('../src/host-folders.ts', import.meta.url)

const {
  addFolder,
  effectiveFolders,
  entryFor,
  folderOfCwd,
  isUnderBase,
  joinSubpath,
  removeFolder,
  rootOf,
  samePath,
  setRoot,
} = await import(coreUrl.href)
const {
  ensureRemoteMarker,
  parseFoldersDocument,
  readFoldersDocument,
  readRemoteMarker,
  remoteSubpath,
  validateFoldersDocument,
  writeFoldersDocument,
} = await import(hostUrl.href)

const BASE = 'C:\\work\\project'
const EXTRA = 'C:\\work\\extra'
let checks = 0
const check = (condition, message) => {
  checks += 1
  assert.ok(condition, message)
}
const equal = (actual, expected, message) => {
  checks += 1
  assert.deepEqual(actual, expected, message)
}

// --- path identity -----------------------------------------------------------
check(samePath('C:\\Work\\Project', 'c:\\work\\project'), 'samePath is case-insensitive for Windows paths')
check(samePath('C:\\work\\project\\', 'C:\\work\\project'), 'samePath ignores a trailing separator')
check(samePath('C:/work/project', 'C:\\work\\project'), 'samePath folds separators on Windows paths')
check(!samePath('/home/me/Project', '/home/me/project'), 'POSIX paths stay case-sensitive')
check(!samePath('/home/me/project', '/home/me/projectfile'), 'a name prefix is not the same path')

// --- effective folders / root ------------------------------------------------
equal(effectiveFolders(BASE, undefined), [BASE], 'base folder is effective without an entry')
equal(effectiveFolders(BASE, { folders: [EXTRA] }), [BASE, EXTRA], 'base comes first, extras keep order')
equal(
  effectiveFolders(BASE, { folders: ['  ', BASE, 'C:\\WORK\\EXTRA', EXTRA, EXTRA] }),
  [BASE, 'C:\\WORK\\EXTRA'],
  'blank, self-referencing and duplicate extras are dropped (first spelling wins)',
)
equal(rootOf(BASE, undefined), BASE, 'root defaults to the workspace path')
equal(rootOf(BASE, { folders: [EXTRA] }), BASE, 'root stays the workspace path when omitted')
equal(rootOf(BASE, { folders: [EXTRA], root: EXTRA }), EXTRA, 'stored root wins')
equal(rootOf(BASE, { folders: [EXTRA], root: 'D:\\gone' }), BASE, 'dangling root falls back to the base')
equal(entryFor({ version: 1, workspaces: { 'ws-1': { folders: [EXTRA] } } }, 'ws-1'), { folders: [EXTRA] }, 'entryFor reads by id')
equal(entryFor({ version: 1, workspaces: {} }, 'ws-2'), undefined, 'entryFor misses cleanly')

// --- cwd ownership -----------------------------------------------------------
const entry = { folders: [EXTRA, 'C:\\work\\extra\\nested'] }
equal(folderOfCwd(undefined, BASE, entry), BASE, 'undefined cwd owns the base')
equal(folderOfCwd('C:\\work\\project\\src', BASE, entry), BASE, 'a workspace cwd owns the base')
equal(folderOfCwd('C:\\work\\extra\\src', BASE, entry), EXTRA, 'an extra folder cwd owns that folder')
equal(folderOfCwd('C:\\work\\extra\\nested\\deep', BASE, entry), 'C:\\work\\extra\\nested', 'the most specific folder wins')
equal(folderOfCwd('D:\\elsewhere', BASE, entry), BASE, 'an outside cwd falls back to the base')
equal(folderOfCwd('C:\\work\\extrabonus', BASE, entry), BASE, 'a name prefix is not an ancestor')
equal(folderOfCwd('C:\\WORK\\EXTRA', BASE, entry), EXTRA, 'cwd matching is case-insensitive')

// --- entry editing (pure, never mutating) ------------------------------------
const before = { folders: [EXTRA] }
const added = addFolder(before, 'D:\\other')
equal(added, { folders: [EXTRA, 'D:\\other'] }, 'addFolder appends')
equal(before, { folders: [EXTRA] }, 'addFolder does not mutate its input')
equal(addFolder({ folders: ['D:\\other'] }, '  D:\\other  '), { folders: ['D:\\other'] }, 'addFolder is idempotent and trims')
equal(addFolder(undefined, EXTRA), { folders: [EXTRA] }, 'addFolder creates an entry')
equal(removeFolder({ folders: [EXTRA], root: EXTRA }, EXTRA), { folders: [] }, 'removeFolder clears a root pointing at it')
equal(
  removeFolder({ folders: [EXTRA, 'D:\\other'], root: 'D:\\other' }, EXTRA),
  { folders: ['D:\\other'], root: 'D:\\other' },
  'removeFolder keeps an unrelated root',
)
equal(setRoot({ folders: [EXTRA] }, EXTRA), { folders: [EXTRA], root: EXTRA }, 'setRoot stores an extra folder')
equal(setRoot({ folders: [EXTRA], root: EXTRA }, BASE), { folders: [EXTRA] }, 'setRoot on the base clears the root')
equal(setRoot(undefined, BASE), { folders: [] }, 'setRoot without extras yields an empty entry')

// --- strict write validation -------------------------------------------------
const valid = { version: 1, workspaces: { 'ws-1': { folders: [EXTRA], root: EXTRA } } }
equal(validateFoldersDocument(valid), valid, 'a valid document round-trips validation')
const rejects = (value, pattern) => {
  checks += 1
  assert.throws(() => validateFoldersDocument(value), pattern)
}
rejects({ version: 2, workspaces: {} }, /version/)
rejects([], /mapping/)
rejects('nope', /mapping/)
rejects({ version: 1, workspaces: { 'ws-1': { folders: ['work'] } } }, /absolute/)
rejects({ version: 1, workspaces: { 'ws-1': { folders: [EXTRA, 'c:\\WORK\\extra'] } } }, /duplicate/)
rejects({ version: 1, workspaces: { 'ws-1': { folders: [EXTRA], root: 'D:\\other' } } }, /root/)
rejects({ version: 1, workspaces: { 'ws-1': { folders: ['C:\\a\u0000b'] } } }, /NUL/)
rejects({ version: 1, workspaces: { 'ws-1': { folders: ['C:\\' + 'a'.repeat(1100)] } } }, /1024/)
rejects({ version: 1, workspaces: { 'ws-1': { folders: Array.from({ length: 33 }, (_, i) => `C:\\w\\${i}`) } } }, /32/)
rejects({ version: 1, workspaces: { ['w'.repeat(201)]: { folders: [EXTRA] } } }, /200/)

// --- tolerant read -----------------------------------------------------------
equal(parseFoldersDocument(undefined), { version: 1, workspaces: {} }, 'undefined parses empty')
equal(parseFoldersDocument({ version: 7, workspaces: {} }), { version: 1, workspaces: {} }, 'a bad version parses empty')
equal(
  parseFoldersDocument({
    version: 1,
    workspaces: {
      'ws-1': { folders: [EXTRA, 'relative', 42, 'c:\\WORK\\extra', ''], root: 'D:\\gone' },
      '': { folders: [EXTRA] },
      'ws-2': 'nope',
    },
  }),
  { version: 1, workspaces: { 'ws-1': { folders: [EXTRA] } } },
  'tolerant parse drops junk instead of throwing',
)

// --- file round-trip ---------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'wg-folders-verify-'))
try {
  equal(await readFoldersDocument(join(dir, 'missing.json')), { version: 1, workspaces: {} }, 'a missing file reads empty')
  await writeFile(join(dir, 'junk.json'), '{not json', 'utf8')
  equal(await readFoldersDocument(join(dir, 'junk.json')), { version: 1, workspaces: {} }, 'unreadable JSON reads empty')
  const path = join(dir, 'nested', 'workspace-groups.folders.json')
  await writeFoldersDocument(path, valid)
  equal(await readFoldersDocument(path), valid, 'atomic write round-trips through the reader')
} finally {
  await rm(dir, { recursive: true, force: true })
}

// --- remote (mirror) workspaces ----------------------------------------------
// A remote-ssh workspace is an ordinary workspace whose directory is a local
// mirror, so extra folders must resolve INSIDE the mirror.
const MIRROR_BASE = 'C:\\Users\\me\\.dsh\\remote-workspaces'
const MIRROR_WS = `${MIRROR_BASE}\\ws-1`
check(isUnderBase(MIRROR_WS, MIRROR_BASE), 'a mirror workspace lives under the mirror base')
check(isUnderBase(`${MIRROR_WS}\\sub`, MIRROR_BASE), 'a mirror subdirectory lives under the mirror base')
check(isUnderBase('C:/Users/ME/.dsh/remote-workspaces/ws-1', MIRROR_BASE), 'mirror detection folds separators and case')
check(!isUnderBase('C:\\work\\project', MIRROR_BASE), 'an ordinary project is not a mirror')
check(!isUnderBase('C:\\Users\\me\\.dsh\\remote-workspaces-other\\ws', MIRROR_BASE), 'a name prefix is not inside the base')

equal(joinSubpath(MIRROR_WS, 'data'), `${MIRROR_WS}\\data`, 'subpath joins under the mirror')
equal(joinSubpath(MIRROR_WS, 'src/generated/'), `${MIRROR_WS}\\src\\generated`, 'subpath normalizes separators and drops a trailing slash')
equal(joinSubpath('/home/me/mirror/ws', 'data/raw'), '/home/me/mirror/ws/data/raw', 'POSIX mirrors join with slashes')
equal(joinSubpath(MIRROR_WS, '  '), null, 'a blank subpath is rejected')
equal(joinSubpath(MIRROR_WS, '..\\escape'), null, 'a parent traversal is rejected')
equal(joinSubpath(MIRROR_WS, 'a/../..'), null, 'an embedded traversal is rejected')
equal(joinSubpath(MIRROR_WS, 'D:\\absolute'), null, 'a Windows absolute path is rejected')
equal(joinSubpath(MIRROR_WS, '/absolute'), null, 'a POSIX absolute path is rejected')
equal(joinSubpath(MIRROR_WS, './ok'), `${MIRROR_WS}\\ok`, 'a leading dot segment is dropped')

// A remote workspace's typed subpath then behaves like any other extra folder.
{
  const entry = addFolder(undefined, joinSubpath(MIRROR_WS, 'data'))
  equal(effectiveFolders(MIRROR_WS, entry), [MIRROR_WS, `${MIRROR_WS}\\data`], 'a typed mirror subpath becomes an extra folder')
  equal(folderOfCwd(`${MIRROR_WS}\\data\\file`, MIRROR_WS, entry), `${MIRROR_WS}\\data`, 'sessions under the mirror subpath belong to it')
}

// --- remote-ssh markers ------------------------------------------------------
// remote-ssh reads `.remote-ssh.json` at the session cwd only (never walking
// up), so an extra folder inside a mirror needs its own record or its sessions
// silently lose the remote terminal.
equal(remoteSubpath('~/projects/cloud-memory', 'data'), '~/projects/cloud-memory/data', 'a ~ root joins with a slash')
equal(remoteSubpath('~', 'data'), '~/data', 'a bare ~ keeps its home meaning')
equal(remoteSubpath('/srv/proj/', 'a/b'), '/srv/proj/a/b', 'an absolute remote root joins with a POSIX slash')
equal(remoteSubpath('/srv/proj', 'a\\b'), '/srv/proj/a/b', 'a Windows-styled subpath still joins POSIX')
equal(remoteSubpath('/srv/proj', '..'), null, 'a parent traversal never reaches the remote shell')
equal(remoteSubpath('/srv/proj', 'a/../b'), null, 'an embedded traversal never reaches the remote shell')
equal(remoteSubpath('/srv/proj', '  '), null, 'a blank subpath is refused')

{
  const mirror = await mkdtemp(join(tmpdir(), 'wg-mirror-verify-'))
  try {
    equal(await readRemoteMarker(mirror), null, 'a directory without a record is not remote-backed')
    const local = await mkdtemp(join(tmpdir(), 'wg-local-verify-'))
    try {
      equal(
        await ensureRemoteMarker(local, join(local, 'sub')),
        { marked: false },
        'a local workspace is left untouched',
      )
      const marker = {
        profileId: 'p-1', host: 'qyhhh.top', port: 22, user: 'ubuntu',
        keyPath: 'C:\\Users\\me\\.ssh\\id_ed25519', remotePath: '~/projects/cloud-memory',
      }
      await writeFile(join(mirror, '.remote-ssh.json'), JSON.stringify(marker, null, 2), 'utf8')
      equal(await readRemoteMarker(mirror), marker, 'the record round-trips')

      const sub = join(mirror, 'data', 'raw')
      equal(
        await ensureRemoteMarker(mirror, sub),
        { marked: true, remotePath: '~/projects/cloud-memory/data/raw' },
        'a nested extra folder gets the remote counterpart of its own path',
      )
      equal(
        await readRemoteMarker(sub),
        { ...marker, remotePath: '~/projects/cloud-memory/data/raw' },
        'the stamped record keeps the connection and only rewrites remotePath',
      )
      await assert.rejects(
        () => ensureRemoteMarker(mirror, join(mirror, '..', 'outside')),
        /folder is not inside the workspace directory/u,
        'a folder outside the mirror is refused, never stamped',
      )
    } finally {
      await rm(local, { recursive: true, force: true })
    }
  } finally {
    await rm(mirror, { recursive: true, force: true })
  }
}

// Success is a single machine-checkable line: the harness pastes this output.
process.stdout.write('folders: all assertions passed\n')

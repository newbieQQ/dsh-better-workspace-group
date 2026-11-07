/**
 * The alias-vs-absolute comparison that decides whether a browsed remote
 * directory is a subfolder of THIS project or a brand-new cloud workspace.
 */
import { describe, expect, it } from 'vitest'
import { normalizeRemotePath, subfolderOf } from '../src/client/remote-paths.ts'

describe('normalizeRemotePath', () => {
  it('unifies separators and strips trailing slashes', () => {
    expect(normalizeRemotePath(' /home/me/app\\ ')).toBe('/home/me/app')
    expect(normalizeRemotePath('/home/me/app///')).toBe('/home/me/app')
    expect(normalizeRemotePath('/')).toBe('/')
    expect(normalizeRemotePath('   ')).toBe('')
  })
})

describe('subfolderOf', () => {
  it('recognises an absolute child of the owner root', () => {
    expect(subfolderOf('/home/me/projects/app', '/home/me/projects/app/data')).toBe('data')
    expect(subfolderOf('/home/me/projects/app', '/home/me/projects/app/data/raw')).toBe('data/raw')
    // Windows-style separators on either side must compare equal.
    expect(subfolderOf('/home/me/projects/app\\', '/home/me/projects/app\\data')).toBe('data')
  })

  it('returns the empty string for the root itself', () => {
    expect(subfolderOf('/home/me/projects/app', '/home/me/projects/app/')).toBe('')
  })

  it('refuses to guess when the owner root is still a ~ alias', () => {
    expect(subfolderOf('~/projects/app', '/home/me/projects/app/data')).toBeNull()
    expect(subfolderOf('~', '/home/me/data')).toBeNull()
  })

  it('returns null for a directory outside the owner root', () => {
    expect(subfolderOf('/home/me/projects/app', '/home/me/other')).toBeNull()
    expect(subfolderOf('/home/me/projects/app', '/home/me/projects/application/data')).toBeNull()
  })

  it('rejects traversal and empty segments', () => {
    expect(subfolderOf('/srv/app', '/srv/app/../escape')).toBeNull()
    expect(subfolderOf('/srv/app', '/srv/app/a/../b')).toBeNull()
    expect(subfolderOf('/srv/app', '/srv/app//data')).toBeNull()
  })

  it('returns null for missing or blank inputs', () => {
    expect(subfolderOf(null, '/srv/app/data')).toBeNull()
    expect(subfolderOf('', '/srv/app/data')).toBeNull()
    expect(subfolderOf('/srv/app', '   ')).toBeNull()
  })
})

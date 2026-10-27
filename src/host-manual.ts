/**
 * Runtime grouping overlay for @dsh-xhl/workspace-groups: manual groups created in
 * the sidebar UI and per-workspace category overrides. Stored in a plugin-
 * owned JSON sidecar (`$DSH_HOME/workspace-groups.manual.json`), separate from
 * the operator YAML — the YAML stays the rule source, this file only records
 * runtime decisions, and writes are atomic (temp file + fsync + rename).
 *
 * The browser PUT route writes the whole overlay (idempotent, last write
 * wins); reads tolerate hand-edited content (parse-only) while the write
 * boundary cross-validates against the current rule categories.
 */
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { ruleDisplayName } from './core/matcher.ts'
import { TOP_LEVEL_ORDER_KEY, UNCATEGORIZED_LABEL, type ManualGroups } from './core/types.ts'

/** Default overlay location: `$DSH_HOME/workspace-groups.manual.json`. */
export function defaultManualPath(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : resolve(homedir(), '.dsh')
  return resolve(home, 'workspace-groups.manual.json')
}

/**
 * Parse + shape-validate a raw overlay document into a ManualGroups.
 * Validates types only — category references are checked against the rule set
 * at the write boundary (validateManualGroups), because reads must tolerate
 * files written while the rule set was different.
 * @param raw - parsed JSON value.
 * @returns the normalized overlay.
 * @throws when the shape is malformed (non-mapping, bad names, duplicates,
 * the reserved uncategorized label, bad assignment/order values).
 */
export function parseManualGroups(raw: unknown): ManualGroups {
  if (raw === undefined || raw === null) return { categories: [], assignments: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('workspace-groups.manual.json: top-level value must be a mapping')
  }
  const source = raw as Record<string, unknown>

  const categories: string[] = []
  if (source.categories !== undefined) {
    if (!Array.isArray(source.categories)) {
      throw new Error('workspace-groups.manual.json: categories must be a list')
    }
    const seen = new Set<string>()
    for (const entry of source.categories) {
      if (typeof entry !== 'string' || entry.trim() === '') {
        throw new Error('workspace-groups.manual.json: each manual category must be a non-empty string')
      }
      const name = entry.trim()
      if (name === UNCATEGORIZED_LABEL) {
        throw new Error(`workspace-groups.manual.json: manual category name "${name}" is reserved`)
      }
      if (seen.has(name)) {
        throw new Error(`workspace-groups.manual.json: duplicate manual category "${name}"`)
      }
      seen.add(name)
      categories.push(name)
    }
  }

  const assignments: Record<string, string | null> = {}
  if (source.assignments !== undefined) {
    if (typeof source.assignments !== 'object' || source.assignments === null || Array.isArray(source.assignments)) {
      throw new Error('workspace-groups.manual.json: assignments must be a mapping')
    }
    for (const [workspaceId, category] of Object.entries(source.assignments)) {
      if (workspaceId.trim() === '') {
        throw new Error('workspace-groups.manual.json: assignment keys must be non-empty')
      }
      if (category === null) {
        assignments[workspaceId] = null // force uncategorized
        continue
      }
      if (typeof category !== 'string' || category.trim() === '') {
        throw new Error(`workspace-groups.manual.json: assignment "${workspaceId}" must be a category name or null`)
      }
      assignments[workspaceId] = category.trim()
    }
  }

  const manual: ManualGroups = { categories, assignments }

  if (source.categoryOrder !== undefined) {
    manual.categoryOrder = parseStringList(source.categoryOrder, 'categoryOrder', true)
  }
  if (source.hidden !== undefined) {
    manual.hidden = parseStringList(source.hidden, 'hidden', true)
  }
  if (source.renamed !== undefined) {
    if (typeof source.renamed !== 'object' || source.renamed === null || Array.isArray(source.renamed)) {
      throw new Error('workspace-groups.manual.json: renamed must be a mapping')
    }
    const renamed: Record<string, string> = {}
    for (const [original, display] of Object.entries(source.renamed)) {
      if (original.trim() === '') throw new Error('workspace-groups.manual.json: renamed keys must be non-empty')
      if (typeof display !== 'string' || display.trim() === '') {
        throw new Error(`workspace-groups.manual.json: renamed "${original}" must be a non-empty string`)
      }
      renamed[original] = display.trim()
    }
    manual.renamed = renamed
  }
  if (source.workspaceOrder !== undefined) {
    if (typeof source.workspaceOrder !== 'object' || source.workspaceOrder === null || Array.isArray(source.workspaceOrder)) {
      throw new Error('workspace-groups.manual.json: workspaceOrder must be a mapping')
    }
    const workspaceOrder: Record<string, string[]> = {}
    for (const [categoryKey, ids] of Object.entries(source.workspaceOrder)) {
      if (categoryKey.trim() === '') {
        throw new Error('workspace-groups.manual.json: workspaceOrder keys must be non-empty')
      }
      workspaceOrder[categoryKey] = parseStringList(ids, `workspaceOrder["${categoryKey}"]`, true)
    }
    manual.workspaceOrder = workspaceOrder
  }

  return manual
}

/** Parse a list of non-empty strings, optionally de-duplicated. */
function parseStringList(value: unknown, field: string, unique: boolean): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`workspace-groups.manual.json: ${field} must be a list`)
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`workspace-groups.manual.json: ${field} entries must be non-empty strings`)
    }
    const trimmed = entry.trim()
    if (unique && seen.has(trimmed)) {
      throw new Error(`workspace-groups.manual.json: ${field} has duplicate entry "${trimmed}"`)
    }
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

/**
 * Cross-validate a parsed overlay against the current rule categories
 * (write boundary only). Every assignment value must be `null`, a rule
 * display name, a manual category name, or the uncategorized label; order
 * keys must reference existing categories; renames/hides must reference
 * actual rule categories.
 * @param manual - parsed overlay.
 * @param ruleCategoryNames - current YAML rule category original names.
 * @throws when the overlay references categories that do not exist.
 */
export function validateManualGroups(manual: ManualGroups, ruleCategoryNames: readonly string[]): void {
  const ruleNames = new Set(ruleCategoryNames)
  const allowed = new Set<string>(ruleCategoryNames.map(name => ruleDisplayName(manual, name)))
  for (const name of manual.categories) allowed.add(name)
  allowed.add(UNCATEGORIZED_LABEL)

  for (const [workspaceId, category] of Object.entries(manual.assignments)) {
    if (category === null) continue
    if (!allowed.has(category)) {
      throw new Error(`workspace-groups.manual.json: assignment "${workspaceId}" references unknown category "${category}"`)
    }
  }
  for (const key of manual.categoryOrder ?? []) {
    if (!allowed.has(key) || key === UNCATEGORIZED_LABEL) {
      throw new Error(`workspace-groups.manual.json: categoryOrder references unknown category "${key}"`)
    }
  }
  for (const key of Object.keys(manual.workspaceOrder ?? {})) {
    // The top-level order key is a reserved, non-category list.
    if (key === TOP_LEVEL_ORDER_KEY) continue
    if (!allowed.has(key) || key === UNCATEGORIZED_LABEL) {
      throw new Error(`workspace-groups.manual.json: workspaceOrder references unknown category "${key}"`)
    }
  }
  for (const original of Object.keys(manual.renamed ?? {})) {
    if (!ruleNames.has(original)) {
      throw new Error(`workspace-groups.manual.json: renamed references unknown rule category "${original}"`)
    }
  }
  for (const original of manual.hidden ?? []) {
    if (!ruleNames.has(original)) {
      throw new Error(`workspace-groups.manual.json: hidden references unknown rule category "${original}"`)
    }
  }
}

/** Read + parse the overlay file. A missing file yields an empty overlay. */
export async function readManualGroups(path: string): Promise<ManualGroups> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { categories: [], assignments: {} }
    throw error
  }
  return parseManualGroups(JSON.parse(text))
}

/**
 * Atomically replace the overlay file: write a same-directory temp file,
 * fsync it, then rename over the target. A crash never leaves a torn JSON at
 * the real path (readers see either the old or the new file).
 * @param path - target file path.
 * @param manual - overlay to persist.
 */
export async function writeManualGroups(path: string, manual: ManualGroups): Promise<void> {
  const json = `${JSON.stringify(manual, null, 2)}\n`
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(json, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(tmp).catch(() => {})
    throw error
  }
  await handle.close()
  try {
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

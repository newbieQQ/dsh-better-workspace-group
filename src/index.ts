/**
 * dsh-workspace-groups host half: serves the sidecar grouping config to the
 * browser half and persists the runtime grouping overlay.
 *
 * Routes:
 * - `GET /workspace-groups/config` — snapshot of the YAML rule categories
 *   merged with the runtime manual overlay (groups + assignments). Read-only
 *   for the rules; the overlay is attached so one fetch boots the browser.
 * - `GET /workspace-groups/tabs` — the persisted session-tab strip (host-side
 *   sidecar; see host-tabs.ts for why it cannot live in the browser).
 * - `PUT /workspace-groups/tabs` — replace the stored strip whole.
 * - `PUT /workspace-groups/manual` — replace the whole manual overlay
 *   (manual groups + per-workspace overrides). Validated against the current
 *   rule categories, written atomically to the plugin-owned JSON sidecar.
 * - `GET /workspace-groups/folders` — the per-workspace extra-folder overlay
 *   plus each workspace's root folder, a `revision` (ETag) and remote-mirror
 *   diagnostics. A read/parse failure is a 500, never an empty document.
 * - `PUT /workspace-groups/folders` — replace the folder overlay whole.
 *   Strictly validated (absolute paths, no duplicates, root membership,
 *   remote-mirror containment), guarded by `If-Match: <revision>` and written
 *   atomically under a serialized compare-and-swap. A stale revision returns
 *   409 with the current document; the accepted document and new revision are
 *   echoed back.
 * - `POST /workspace-groups/folders` — deprecated; returns 410 without reading
 *   the payload or touching remote-ssh records.
 *
 * - `GET /workspace-groups/remote-hint?path=...` — presence-only marker hint
 *   at the requested absolute path or ancestors; never returns marker content;
 * - `POST /workspace-groups/farm` — gather several folders into one real
 *   directory of links, so a single session can reach all of them;
 * - `DELETE /workspace-groups/farm?path=...` — remove such a farm; only links
 *   are unlinked, meeting a real directory aborts.
 *
 * Core workspace.json / session storage is never touched.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GroupsContext } from './context-types.ts'
import { defaultConfigPath, readGroupsConfig } from './host-config.ts'
import {
  defaultManualPath,
  parseManualGroups,
  readManualGroups,
  validateManualGroups,
  writeManualGroups,
} from './host-manual.ts'
import {
  defaultTabsPath,
  documentForTabs,
  parsePersistedTab,
  readTabsDocument,
  writeTabsDocument,
  type PersistedTab,
  type TabsDocument,
} from './host-tabs.ts'
import {
  defaultFoldersPath,
  hasRemoteMarkerHint,
  readFoldersState,
  remoteMirrorBaseDiagnostic,
  replaceFoldersDocument,
  validateFoldersDocument,
  validateRemoteHintPath,
  type FoldersState,
  type RemoteMirrorBaseDiagnostic,
} from './host-folders.ts'
import { buildFarm, removeFarm } from './host-farm.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'workspace-groups-local'

/** Services required before mounting: the webserver route. */
export const inject = ['webServer']

/** Cap on the manual/tabs PUT body: those overlays are tiny. */
const MAX_MANUAL_BODY_BYTES = 64 * 1024

/**
 * Cap on the folder PUT body.
 *
 * This must NOT reuse `MAX_MANUAL_BODY_BYTES`: the folder validator allows up
 * to 32 folders and 16 members per workspace, each with up to 1024-character
 * paths, so a single perfectly legal workspace can exceed 64 KiB. A 64 KiB cap
 * meant that once a document grew past it, every further edit returned 413 and
 * the overlay became un-editable. 1 MiB is still a hard bound against abuse.
 */
const MAX_FOLDERS_BODY_BYTES = 1024 * 1024

/** Error with an HTTP status, mapped to a plain-text 4xx/5xx response. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/**
 * Shape-validate a PUT /tabs body.
 *
 * Returns null on a malformed payload rather than throwing, so the route can
 * answer 400 without a try/catch around the parse. Individual bad tab rows are
 * dropped (the strip is a display cache; one bad row must not reject a whole
 * write), and duplicate session ids are collapsed to the first.
 *
 * @param raw - parsed request body.
 * @returns the payload, or null when the envelope is unusable.
 */
function parseTabsPayload(raw: unknown): { order: number; tabs: PersistedTab[] } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  if (typeof source.order !== 'number' || !Number.isFinite(source.order)) return null
  if (!Array.isArray(source.tabs)) return null
  const tabs: PersistedTab[] = []
  const seen = new Set<string>()
  for (const entry of source.tabs) {
    const tab = parsePersistedTab(entry)
    if (tab === null) continue
    if (seen.has(tab.sessionId)) continue
    seen.add(tab.sessionId)
    tabs.push(tab)
  }
  return { order: source.order, tabs }
}

/** Write a plain-text error response with the given status. */
function writeError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(message)
}

/** Collect the request body as UTF-8 text, rejecting oversized bodies. */
async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new HttpError(413, 'request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) throw new HttpError(400, 'empty request body')
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * The one response envelope shared by GET, PUT echo and 409.
 *
 * GET and PUT used to disagree: GET added `remoteBase`, PUT echoed only the
 * document. A client that replaced its state with the PUT response lost
 * `remoteBase` until the next reload. Both now carry the same diagnostics plus
 * the exact revision, so the client can render what the host accepted AND keep
 * its optimistic-concurrency token.
 */
function foldersEnvelope(
  state: FoldersState,
  diagnostic: RemoteMirrorBaseDiagnostic,
  revision = state.revision,
): Record<string, unknown> {
  return {
    ...state.document,
    remoteBase: diagnostic.base,
    ...(diagnostic.warning === undefined ? {} : { remoteBaseWarning: diagnostic.warning }),
    ...(state.schemaWarning === undefined ? {} : { schemaWarning: state.schemaWarning }),
    revision,
  }
}

/** Turn an HTTP If-Match value (possibly quoted / weak) into a bare revision. */
function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//u, '').replace(/^"|"$/gu, '')
}

/** Send a JSON folder envelope with the standard no-store headers. */
function sendFolders(
  res: ServerResponse,
  status: number,
  body: string,
  revision: string,
  method?: string,
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'ETag': `"${revision}"`,
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(method === 'HEAD' ? undefined : body)
}

/** Plugin body: mount the config snapshot route and the overlay write route. */
export function apply(ctx: GroupsContext): void {
  const configPath = defaultConfigPath()
  const manualPath = defaultManualPath()
  const tabsPath = defaultTabsPath()
  const foldersPath = defaultFoldersPath()

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/workspace-groups/config',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeError(res, 405, 'method not allowed')
        return
      }
      let config
      let manual
      try {
        ;[config, manual] = await Promise.all([
          readGroupsConfig(configPath),
          readManualGroups(manualPath),
        ])
      } catch (error) {
        writeError(res, 500, `workspace-groups: failed to read config: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      const body = JSON.stringify({ ...config, manual })
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), '@dsh-xhl/workspace-groups: /workspace-groups/config route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/workspace-groups/tabs',
    handler: async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        let stored: TabsDocument | null
        try {
          stored = await readTabsDocument(tabsPath)
        } catch (error) {
          writeError(res, 500, `workspace-groups: failed to read tabs: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        const body = JSON.stringify({ tabs: stored?.tabs ?? [] })
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(body),
        })
        res.end(req.method === 'HEAD' ? undefined : body)
        return
      }
      if (req.method !== 'PUT') {
        writeError(res, 405, 'method not allowed')
        return
      }
      let raw: unknown
      try {
        raw = JSON.parse(await readBody(req, MAX_MANUAL_BODY_BYTES))
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 400
        writeError(res, status, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      const parsed = parseTabsPayload(raw)
      if (parsed === null) {
        writeError(res, 400, 'workspace-groups: malformed tabs payload')
        return
      }
      try {
        await writeTabsDocument(tabsPath, documentForTabs(parsed))
      } catch (error) {
        writeError(res, 500, `workspace-groups: failed to write tabs: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      const body = JSON.stringify({ ok: true })
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
    },
  }), '@dsh-xhl/workspace-groups: /workspace-groups/tabs route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/workspace-groups/manual',
    handler: async (req, res) => {
      if (req.method !== 'PUT') {
        writeError(res, 405, 'method not allowed')
        return
      }
      let raw: unknown
      try {
        raw = JSON.parse(await readBody(req, MAX_MANUAL_BODY_BYTES))
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 400
        writeError(res, status, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      let manual
      try {
        manual = parseManualGroups(raw)
        // The write boundary knows the current rule set; reject assignments
        // into categories that exist nowhere (catches stale client state).
        const ruleConfig = (await readGroupsConfig(configPath)).categories
        validateManualGroups(manual, ruleConfig.map(category => category.name))
      } catch (error) {
        writeError(res, 400, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      try {
        await writeManualGroups(manualPath, manual)
      } catch (error) {
        writeError(res, 500, `workspace-groups: failed to write manual overlay: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      const body = JSON.stringify({ ok: true })
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
    },
  }), '@dsh-xhl/workspace-groups: /workspace-groups/manual route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/workspace-groups/remote-hint',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeError(res, 405, 'method not allowed')
        return
      }
      let path: string
      try {
        const url = new URL(req.url ?? '', 'http://localhost')
        path = validateRemoteHintPath(url.searchParams.get('path'))
      } catch {
        writeError(res, 400, 'workspace-groups: invalid remote hint path')
        return
      }
      let remoteHint: boolean
      try {
        remoteHint = await hasRemoteMarkerHint(path)
      } catch {
        writeError(res, 500, 'workspace-groups: failed to inspect remote hint; local fallback is unsafe')
        return
      }
      const body = JSON.stringify({ remoteHint })
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), '@dsh-xhl/workspace-groups: /workspace-groups/remote-hint route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/workspace-groups/folders',
    handler: async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        // A read failure is an ERROR, never an empty document. The old reader
        // swallowed EACCES / EISDIR / EBUSY / torn JSON and returned 200 + {},
        // which the browser then PUT back, erasing every workspace's folders.
        // `revision` is the ETag that PUT must echo in If-Match.
        let state: FoldersState
        try {
          state = await readFoldersState(foldersPath)
        } catch (error) {
          writeError(res, 500, `workspace-groups: cannot read folder overlay: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        const diagnostic = remoteMirrorBaseDiagnostic()
        sendFolders(res, 200, JSON.stringify(foldersEnvelope(state, diagnostic)), state.revision, req.method)
        return
      }
      if (req.method === 'POST') {
        // Child markers neither register model-tool context nor preserve the
        // parent's writeBack guard. Never read, write or remove any marker.
        writeError(res, 410, 'workspace-groups: remote marker creation is deprecated; use the registered remote workspace root')
        return
      }
      if (req.method !== 'PUT') {
        writeError(res, 405, 'method not allowed')
        return
      }
      let raw: unknown
      try {
        raw = JSON.parse(await readBody(req, MAX_FOLDERS_BODY_BYTES))
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 400
        writeError(res, status, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      const diagnostic = remoteMirrorBaseDiagnostic()
      let document
      try {
        // The host is the final trust boundary: remote members must stay inside
        // the mirror base, not just in the browser's own checks.
        document = validateFoldersDocument(raw, diagnostic.base)
      } catch (error) {
        writeError(res, 400, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      const ifMatch = req.headers?.['if-match']
      const expectedRevision = typeof ifMatch === 'string' ? normalizeEtag(ifMatch) : undefined
      let result
      try {
        // Serialized read -> compare -> write. A concurrent second writer either
        // wins first and this one sees a changed revision (409), or waits.
        result = await replaceFoldersDocument(foldersPath, expectedRevision, document)
      } catch (error) {
        writeError(res, 500, `workspace-groups: failed to write folder overlay: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      if (!result.ok) {
        // 409 carries the CURRENT server document so the client can reload and
        // re-apply its change instead of silently overwriting it.
        const body = JSON.stringify(foldersEnvelope(result.state, diagnostic))
        sendFolders(res, 409, body, result.state.revision)
        return
      }
      // Echo the normalized document AND the new revision: the client renders
      // exactly what the host accepted and chains the next write from it.
      const body = JSON.stringify(foldersEnvelope(
        { document, revision: result.revision, missing: false },
        diagnostic,
      ))
      sendFolders(res, 200, body, result.revision)
    },
  }), '@dsh-xhl/workspace-groups: /workspace-groups/folders route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/workspace-groups/farm',
    handler: async (req, res) => {
      if (req.method === 'POST') {
        let raw: unknown
        try {
          raw = JSON.parse(await readBody(req, MAX_FOLDERS_BODY_BYTES))
        } catch (error) {
          const status = error instanceof HttpError ? error.status : 400
          writeError(res, status, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        const body = raw as { name?: unknown; folders?: unknown } | null
        if (body === null || typeof body !== 'object' || !Array.isArray(body.folders)) {
          writeError(res, 400, 'workspace-groups: farm needs { name, folders: string[] }')
          return
        }
        let result
        try {
          // Nothing is copied: every entry is a link to a folder the user owns.
          result = await buildFarm({
            name: typeof body.name === 'string' ? body.name : 'farm',
            folders: body.folders,
          })
        } catch (error) {
          writeError(res, 400, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        const payload = JSON.stringify(result)
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(payload),
        })
        res.end(payload)
        return
      }
      if (req.method === 'DELETE') {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const target = url.searchParams.get('path')
        if (target === null || target.trim() === '') {
          writeError(res, 400, 'workspace-groups: farm needs ?path=')
          return
        }
        try {
          // Unlinks entries only; a real directory inside aborts the removal
          // instead of being deleted with everything under it.
          await removeFarm(target)
        } catch (error) {
          writeError(res, 400, `workspace-groups: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        const payload = JSON.stringify({ ok: true })
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(payload),
        })
        res.end(payload)
        return
      }
      writeError(res, 405, 'method not allowed')
    },
  }), '@dsh-xhl/workspace-groups: /workspace-groups/farm route')
}

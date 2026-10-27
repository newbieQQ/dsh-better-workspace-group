/**
 * The session tab strip: one chip per opened conversation, rendered into the
 * DOM seat at the head of the conversation column (see `tab-seat.ts` for why
 * this is a DOM injection rather than a slot).
 *
 * A tab is a *view* of the open session, not a second navigation model:
 * clicking a chip navigates through `ctx.uiWorkspace.openSession`, which is the
 * one path that retains a target session; the owning component derives the
 * strip from the open session plus the tab store.
 *
 * The active chip is derived, never stored: it is the chip whose session is the
 * open one, so clicking a background chip immediately shows that chip active.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseFillMedium, StateDot, Tooltip, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionsTabsProps } from './contract.ts'
import { mountTabSeat } from './tab-seat.ts'
import { orderedTabs, projectIndex, tabIndicator, type SessionTab, type SessionTabIndicator } from './tabs.ts'
import { currentSessionId } from './tree.ts'

/** Dot state for one tab (the sidebar's session rows share this vocabulary). */
function dotState(indicator: SessionTabIndicator): StateDotState {
  if (indicator.attention) return 'warning'
  if (indicator.running) return 'ongoing'
  return 'done'
}

/**
 * Render the session tab strip into the conversation column's head seat.
 * @param props - tab store, catalog/status hooks, navigation, locale.
 * @returns the portal (or null until the column has mounted).
 */
export function SessionTabs({
  useTabs,
  actions,
  useSessions,
  useSessionStatus,
  useWorkspaces,
  activate,
  rename,
  t,
}: SessionsTabsProps) {
  const tabs = useTabs(s => s.tabs)
  const list = useSessions(s => s)
  const statuses = useSessionStatus(s => s)
  const currentId = useSessions(s => currentSessionId(s))
  const workspaces = useWorkspaces(s => s.items)

  // Session → owning project, in one pass over the workspace registry. This is
  // what lets each chip name its project; without it a strip of session titles
  // is ambiguous as soon as two projects are open.
  const projects = useMemo(() => projectIndex(workspaces), [workspaces])

  // The seat is a DOM node outside React's tree, so it cannot arrive through
  // props; it is discovered once per mount and held in state to trigger the
  // portal's first render when the column appears.
  const [seat, setSeat] = useState<HTMLElement | null>(null)
  // The scrolling row, for wheel redirection and keep-active-in-view.
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const mounted = mountTabSeat(setSeat)
    // The column may already exist, in which case onReady fired synchronously
    // during mountTabSeat and setSeat is already queued; adopt it here too so
    // the very first paint has a host instead of waiting a frame.
    if (mounted.host !== null) setSeat(mounted.host)
    return () => {
      mounted.dispose()
      // The portal must stop targeting a removed node before the next mount.
      setSeat(null)
    }
  }, [])

  // The strip renders exactly the tabs the store holds. There is deliberately NO
  // filtering against the session catalog and no "close tabs whose session
  // vanished" sweep: a tab is removed when the USER closes it, and by nothing
  // else. Trimming automatically also misfires — the catalog is briefly empty on
  // every load, which deleted restored tabs before the sessions arrived.
  //
  // Arrival order is the only order: the active tab is marked, never moved.
  const display = useMemo(() => orderedTabs(tabs, currentId), [tabs, currentId])

  // With the row scrollable, the active chip can sit outside the viewport —
  // e.g. after clicking a session in the sidebar that has a tab far to the
  // right. Bring it into view on selection change. `block: 'nearest'` keeps
  // this a horizontal-only scroll, and `inline: 'nearest'` avoids nudging the
  // row when the chip is already fully visible.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null || currentId === undefined) return
    const chip = el.querySelector<HTMLElement>(`[data-tab-session="${CSS.escape(currentId)}"]`)
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [currentId, display.length])

  if (seat === null || display.length === 0) return null

  return createPortal(
    <div className="wgTabs" role="tablist" aria-label={t('tabs.aria')}>
      <div
        className="wgTabsScroll"
        ref={scrollRef}
        onWheel={(event) => {
          // A plain wheel reports only `deltaY`, and the overflow here is
          // horizontal, so without this the wheel would do nothing over the
          // strip (or scroll the transcript behind it). Redirect the dominant
          // delta to scrollLeft, and only swallow the event once there is
          // somewhere left to scroll — otherwise a wheel at either end keeps
          // propagating and the page still scrolls normally.
          const el = event.currentTarget
          if (el.scrollWidth <= el.clientWidth) return
          const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
          if (delta === 0) return
          const atStart = el.scrollLeft <= 0 && delta < 0
          const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && delta > 0
          if (atStart || atEnd) return
          el.scrollLeft += delta
          event.preventDefault()
        }}
      >
        {display.map((tab: SessionTab) => {
          const summary = list.byId[tab.sessionId]
          // A restored tab can render before its catalog row arrives. Show the
          // session id meanwhile rather than an empty chip — the tab is real, and
          // the title fills in as soon as the catalog catches up.
          const label = summary === undefined
            ? tab.sessionId
            : summary.blank ? t('newSession') : summary.displayTitle
          const active = tab.sessionId === currentId
          const indicator = tabIndicator(summary, statuses.get(tab.sessionId))
          // The project this session belongs to. Absent for a session that is in
          // no workspace (a bare session, or one just created before the
          // registry caught up) — the chip then shows the title alone rather
          // than a placeholder.
          const project = projects.get(tab.sessionId)
          // Title attribute carries the full pair plus the directory, so the
          // truncated chip text is recoverable on hover.
          const tip = project === undefined
            ? label
            : `${project.label} · ${label}\n${project.path}`
          return (
            <div
              key={tab.order}
              className={`wgTab${active ? ' wgTabActive' : ''}`}
              data-tab-session={tab.sessionId}
              {...(project !== undefined ? { 'data-tab-project': project.workspaceId } : {})}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="wgTabMain"
                title={tip}
                onClick={() => { activate(tab.sessionId) }}
                onDoubleClick={() => { rename(tab.sessionId, label) }}
              >
                <span className="wgTabStatus" data-tab-state={indicator.attention ? 'attention' : indicator.running ? 'running' : indicator.unread ? 'unread' : indicator.settled ? 'settled' : 'idle'}>
                  <StateDot state={dotState(indicator)} />
                </span>
                {/* Two stacked lines, folder-style: the project (short, quiet)
                    over the session title (long, primary). The project line is
                    omitted for a session in no workspace, which lets the title
                    use the full height rather than leaving a blank row. */}
                <span className="wgTabText">
                  {project !== undefined && (
                    <span className="wgTabProject" title={project.path}>{project.label}</span>
                  )}
                  <span className="wgTabLabel">{label}</span>
                </span>
              </button>
              <Tooltip label={t('tabs.close')} side="top" delayMs={600}>
                <button
                  type="button"
                  className="wgTabClose"
                  aria-label={`${t('tabs.close')} ${label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    actions.close(tab.sessionId)
                  }}
                >
                  <IconCloseFillMedium />
                </button>
              </Tooltip>
            </div>
          )
        })}
      </div>
    </div>,
    seat,
  )
}

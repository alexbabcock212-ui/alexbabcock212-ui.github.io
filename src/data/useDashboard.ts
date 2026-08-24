import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchPayload, isConfigured } from './api'
import { clearCachedPayload, loadCachedPayload, saveCachedPayload } from './cache'
import { courseFolders, term } from './courses'
import { adoptDeviceKey, clearDeviceKey, saveDeviceKey } from './deviceKey'
import { isStale, scheduleMorning } from './morning'
import type { Payload, RawEvent } from './payload'
import {
  codeKey,
  courseOf,
  eventsOn,
  toAllocation,
  toChips,
  toLede,
  toSchedule,
} from './sources/calendar'
import type { CalendarEvent } from './sources/calendar'
import { toCourses } from './sources/courses'
import { toClusters } from './sources/mail'
import { toDeadlines } from './sources/tasks'
import type { Dashboard } from './types'

/* ── shaping ───────────────────────────────────────────────────────────── */

function toEvents(raw: RawEvent[], now: Date): CalendarEvent[] {
  return raw
    .map((e) => ({
      id: e.id,
      title: e.title,
      location: e.location,
      calendar: e.calendar ?? '',
      start: new Date(e.start),
      end: new Date(e.end),
      course: courseOf(e.calendar ?? '', e.title, now),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

/**
 * The board with nothing fetched.
 *
 * Courses are still listed: they come from the Desktop scan, which is in the
 * bundle and needs no network and no key. In the week before term starts that
 * is the only screen with anything real on it, and it should show it.
 */
function emptyDashboard(now = new Date()): Dashboard {
  return {
    calendar: 'not-connected',
    tasks: 'not-connected',
    mail: 'not-connected',
    allocation: [],
    schedule: [],
    lede: null,
    chips: [],
    deadlines: [],
    clusters: [],
    courses: toCourses([], now, courseFolders, term),
    fetchedAt: null,
  }
}

function derive(payload: Payload, now: Date): Dashboard {
  const events = toEvents(payload.calendar.items, now)
  const todays = eventsOn(events, now)
  const allocation = toAllocation(todays)
  const courses = toCourses(events, now, courseFolders, term)

  // Courses already resolved which week of term it is and what each course is
  // covering; the timeline reads it back rather than recomputing.
  const topics = new Map(
    courses.flatMap((c) => {
      const lecture = c.lectures.find((l) => l.week === c.currentWeek)
      return lecture ? [[codeKey(c.code), lecture] as const] : []
    }),
  )

  return {
    calendar: payload.calendar.ok ? 'ready' : 'error',
    tasks: payload.tasks.ok ? 'ready' : 'error',
    mail: payload.mail.ok ? 'ready' : 'error',

    allocation,
    schedule: toSchedule(todays, topics),
    chips: toChips(allocation, todays.filter((e) => e.course).length),
    lede: toLede(todays),

    deadlines: toDeadlines(payload.tasks.items, payload.allDay.items, now),
    clusters: toClusters(payload.mail.items, now),
    courses,

    fetchedAt: payload.fetchedAt || null,
  }
}

/** One source failing should say so without pretending the rest failed too. */
function feedError(payload: Payload): string | null {
  const broken = (
    [
      ['Calendar', payload.calendar],
      ['Tasks', payload.tasks],
      ['Mail', payload.mail],
    ] as const
  ).filter(([, feed]) => !feed.ok)

  if (broken.length === 0) return null
  if (broken.length === 3) return broken[0][1].error ?? 'Nothing could be read.'
  return `${broken.map(([name]) => name).join(' and ')} could not be read.`
}

/* ── the hook ──────────────────────────────────────────────────────────── */

export interface DashboardHandle {
  dashboard: Dashboard
  error: string | null
  /** A read is in flight. */
  busy: boolean
  /** This device has no working key — the only thing that ever needs a human. */
  needsKey: boolean
  /** True once a key is installed and the service is reachable. */
  configured: boolean
  /** `fresh` bypasses the Worker's short cache. */
  refresh: (fresh?: boolean) => void
  installKey: (key: string) => void
  forget: () => void
}

export function useDashboard(): DashboardHandle {
  // Runs once, and has a side effect: it strips `#key=…` off the URL.
  const [key, setKey] = useState(adoptDeviceKey)
  const [payload, setPayload] = useState<Payload | null>(loadCachedPayload)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState(false)

  // Listeners and timers need the *current* freshness without being torn down
  // and rebuilt every time a fetch lands, so it is mirrored into a ref.
  const fetchedAt = useRef<number | null>(payload?.fetchedAt ?? null)
  useEffect(() => {
    fetchedAt.current = payload?.fetchedAt ?? null
  }, [payload])

  const load = useCallback(async (deviceKey: string, fresh: boolean) => {
    if (!deviceKey || !isConfigured()) return
    setBusy(true)
    try {
      const next = await fetchPayload(deviceKey, fresh)
      saveCachedPayload(next)
      setPayload(next)
      setError(feedError(next))
      setRejected(false)
    } catch (e) {
      if (e instanceof ApiError && e.needsKey) setRejected(true)
      setError(e instanceof Error ? e.message : 'Could not load.')
    } finally {
      setBusy(false)
    }
  }, [])

  // Open against the cache, then correct it — but only when the cache is
  // actually out of date, so a tab switch at noon costs nothing.
  useEffect(() => {
    if (isStale(fetchedAt.current)) void load(key, false)
  }, [key, load])

  // Coming back to the app is the moment worth re-reading on: it covers both
  // the overnight case and simply having left it open in a pocket.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isStale(fetchedAt.current)) {
        void load(key, false)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    globalThis.addEventListener?.('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      globalThis.removeEventListener?.('focus', onVisible)
    }
  }, [key, load])

  // 6:45, every morning, whenever the app is alive to hear it.
  useEffect(() => scheduleMorning(() => void load(key, true)), [key, load])

  const refresh = useCallback((fresh = true) => void load(key, fresh), [key, load])

  const installKey = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      saveDeviceKey(trimmed)
      setKey(trimmed)
      setRejected(false)
      setError(null)
      void load(trimmed, true)
    },
    [load],
  )

  const forget = useCallback(() => {
    clearDeviceKey()
    clearCachedPayload()
    setKey('')
    setPayload(null)
    setRejected(false)
    setError(null)
  }, [])

  const dashboard = useMemo(
    () => (payload ? derive(payload, new Date()) : emptyDashboard()),
    [payload],
  )

  return {
    dashboard,
    error,
    busy,
    needsKey: !isConfigured() || key === '' || rejected,
    configured: isConfigured(),
    refresh,
    installKey,
    forget,
  }
}

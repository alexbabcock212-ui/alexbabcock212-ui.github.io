import { useCallback, useEffect, useState } from 'react'
import { dashboard as empty } from './dashboard'
import { isConfigured, requestToken, signOut as revoke, storedToken } from './google/auth'
import { clearCachedEvents, loadCachedEvents, saveCachedEvents } from './google/cache'
import {
  CalendarError,
  eventsOn,
  fetchEvents,
  toAllocation,
  toChips,
  toCourses,
  toLede,
  toSchedule,
} from './google/calendar'
import type { CalendarEvent } from './google/calendar'
import type { Dashboard } from './types'

/** Shape a fetched-or-cached set of events into everything the screens read. */
function derive(events: CalendarEvent[], fetchedAt: number, now: Date): Dashboard {
  const todays = eventsOn(events, now)
  const allocation = toAllocation(todays)

  return {
    ...empty,
    calendar: 'ready',
    fetchedAt,
    schedule: toSchedule(todays),
    allocation,
    chips: toChips(allocation, todays.filter((e) => e.course).length),
    lede: toLede(todays),
    courses: toCourses(events, now),
  }
}

/**
 * Open against whatever the last read left behind.
 *
 * A cached fortnight of events still answers correctly for today, so the app
 * shows a real timetable immediately — offline, or with an access token that
 * expired days ago — instead of an empty screen and a sign-in button.
 */
function initial(): Dashboard {
  const cached = loadCachedEvents()
  if (cached) return derive(cached.events, cached.fetchedAt, new Date())
  return isConfigured() && storedToken() ? { ...empty, calendar: 'loading' } : empty
}

export interface DashboardHandle {
  dashboard: Dashboard
  error: string | null
  /** True when a live token is in hand, so a refresh needs no interaction. */
  canRefresh: boolean
  connect: () => void
  disconnect: () => void
}

export function useDashboard(): DashboardHandle {
  const [dashboard, setDashboard] = useState<Dashboard>(initial)
  const [error, setError] = useState<string | null>(null)
  const [canRefresh, setCanRefresh] = useState(() => Boolean(isConfigured() && storedToken()))

  // Touches no state before its first await, so mounting cannot cascade.
  const load = useCallback(async (accessToken: string) => {
    try {
      const now = new Date()
      const events = await fetchEvents(accessToken, now)
      const fetchedAt = Date.now()
      saveCachedEvents(events, fetchedAt)
      setDashboard(derive(events, fetchedAt, now))
      setError(null)
      setCanRefresh(true)
    } catch (e) {
      const needsReauth = e instanceof CalendarError && e.needsReauth
      if (needsReauth) setCanRefresh(false)
      setError(e instanceof CalendarError ? e.message : 'Could not reach Google Calendar.')
      // Keep whatever is on screen: stale events beat a blank screen.
      setDashboard((d) => (d.calendar === 'ready' ? d : { ...d, calendar: 'error' }))
    }
  }, [])

  // Refresh in the background when a token is still good. Never blocks paint —
  // the cache has already filled the screen.
  useEffect(() => {
    const token = isConfigured() ? storedToken() : null
    if (token) void load(token.accessToken)
  }, [load])

  // Must run from the click itself: the flow opens a popup.
  const connect = useCallback(() => {
    setError(null)
    setDashboard((d) => (d.calendar === 'ready' ? d : { ...d, calendar: 'loading' }))
    requestToken().then(
      (token) => void load(token.accessToken),
      (e: unknown) => {
        setError(e instanceof Error ? e.message : 'Sign-in failed.')
        setDashboard((d) => (d.calendar === 'loading' ? { ...d, calendar: 'error' } : d))
      },
    )
  }, [load])

  const disconnect = useCallback(() => {
    void revoke()
    clearCachedEvents()
    setDashboard(empty)
    setCanRefresh(false)
    setError(null)
  }, [])

  return { dashboard, error, canRefresh, connect, disconnect }
}

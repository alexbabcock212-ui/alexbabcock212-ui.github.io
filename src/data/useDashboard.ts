import { useCallback, useEffect, useState } from 'react'
import { dashboard as empty } from './dashboard'
import { isConfigured, requestToken, signOut as revoke, storedToken } from './google/auth'
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
import type { Dashboard } from './types'

export interface DashboardHandle {
  dashboard: Dashboard
  /** Set when the last attempt failed, for the UI to show. */
  error: string | null
  connect: () => void
  disconnect: () => void
}

/** A token cached from an earlier launch is good for the rest of its hour, so
 *  the first render can show "loading" rather than "not connected". */
const initial = (): Dashboard =>
  isConfigured() && storedToken() ? { ...empty, calendar: 'loading' } : empty

export function useDashboard(): DashboardHandle {
  const [dashboard, setDashboard] = useState<Dashboard>(initial)
  const [error, setError] = useState<string | null>(null)

  // Deliberately touches no state before its first await: callers set
  // 'loading' themselves, so mounting this never triggers a cascading render.
  const load = useCallback(async (accessToken: string) => {
    try {
      const now = new Date()
      const events = await fetchEvents(accessToken, now)
      const todays = eventsOn(events, now)
      const allocation = toAllocation(todays)

      setDashboard((d) => ({
        ...d,
        calendar: 'ready',
        schedule: toSchedule(todays),
        allocation,
        chips: toChips(allocation, todays.filter((e) => e.course).length),
        lede: toLede(todays),
        courses: toCourses(events, now),
      }))
    } catch (e) {
      const message =
        e instanceof CalendarError ? e.message : 'Could not reach Google Calendar.'
      setError(message)
      setDashboard((d) => ({ ...d, calendar: 'error' }))
    }
  }, [])

  useEffect(() => {
    const token = isConfigured() ? storedToken() : null
    // oxlint-disable-next-line react/set-state-in-effect -- load() awaits the
    // network before touching state, and the initial 'loading' value is set
    // during render above, so this cannot cascade.
    if (token) void load(token.accessToken)
  }, [load])

  // Must run from the click itself: the flow opens a popup.
  const connect = useCallback(() => {
    setError(null)
    setDashboard((d) => ({ ...d, calendar: 'loading' }))
    requestToken().then(
      (token) => void load(token.accessToken),
      (e: unknown) => setError(e instanceof Error ? e.message : 'Sign-in failed.'),
    )
  }, [load])

  const disconnect = useCallback(() => {
    void revoke()
    setDashboard(empty)
    setError(null)
  }, [])

  return { dashboard, error, connect, disconnect }
}

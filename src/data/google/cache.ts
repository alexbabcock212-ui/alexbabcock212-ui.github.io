/**
 * The last calendar read, kept on the device.
 *
 * This is what makes reconnecting rare. The fetch covers a two-week window of
 * events, and a timetable is recurring, so a cache taken today still answers
 * "what are my classes on Thursday?" correctly for a fortnight. The app can
 * therefore open instantly — offline, or with a long-dead access token — and
 * only needs a new token when the window itself runs out.
 */
import type { CalendarEvent } from './calendar'

const KEY = 'life-dashboard:calendar'

/** Matches the fetch horizon; past it, the cache can no longer answer for today. */
const WINDOW_DAYS = 14

interface StoredEvent {
  id: string
  title: string
  location: string
  start: string
  end: string
  course: CalendarEvent['course']
}

interface Stored {
  fetchedAt: number
  events: StoredEvent[]
}

export interface CachedCalendar {
  events: CalendarEvent[]
  fetchedAt: number
}

export function loadCachedEvents(now = Date.now()): CachedCalendar | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return null

    const stored = JSON.parse(raw) as Stored
    if (!stored?.fetchedAt || !Array.isArray(stored.events)) return null

    // Past the window the cached events no longer reach today.
    if (now - stored.fetchedAt > WINDOW_DAYS * 86_400_000) return null

    return {
      fetchedAt: stored.fetchedAt,
      events: stored.events.map((e) => ({
        ...e,
        start: new Date(e.start),
        end: new Date(e.end),
      })),
    }
  } catch {
    return null
  }
}

export function saveCachedEvents(events: CalendarEvent[], now = Date.now()): void {
  try {
    const payload: Stored = {
      fetchedAt: now,
      events: events.map((e) => ({
        ...e,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
      })),
    }
    globalThis.localStorage?.setItem(KEY, JSON.stringify(payload))
  } catch {
    // Quota or private mode — the app just refetches next time.
  }
}

export function clearCachedEvents(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Nothing to do.
  }
}

/**
 * Google Calendar → the dashboard's shapes.
 *
 * Everything here is derived from real events. Where the calendar cannot know
 * something — a lecture's topic, its readings, how far through the term a
 * course is — the field is left empty rather than guessed, and the views hide
 * it. Those gaps close when syllabus data exists, not before.
 */
import type { AllocSegment, Chip, Course, Slot } from '../types'

const API = 'https://www.googleapis.com/calendar/v3'

/** How far ahead to look when working out the term's meeting pattern. */
const HORIZON_DAYS = 14

/** The window the "unclaimed hours" figure is measured against: 08:00–24:00. */
const DAY_START_HOUR = 8
const DAY_END_HOUR = 24

interface ApiEvent {
  id: string
  summary?: string
  location?: string
  status?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string }
}

export interface CalendarEvent {
  id: string
  title: string
  location: string
  start: Date
  end: Date
  /** Set when the title carries a course code, e.g. `Econ 2122`. */
  course: { code: string; subject: string; number: string } | null
}

/* ── course codes ──────────────────────────────────────────────────────── */

/**
 * Matches a subject word followed by a four-digit catalogue number, which is
 * how the events are titled — `Classics 2440`, `Econ 2122`, `Mos 2310`. The
 * subject is a word, not an uppercase department code, so `[A-Z]{2,4}` style
 * patterns do not work here.
 *
 * Tolerates surrounding text, so `Econ 2122 - 001 LEC` and
 * `Managerial Accounting (Mos 2310)` both resolve.
 */
const COURSE_RE = /(?:^|[^A-Za-z])([A-Za-z][A-Za-z&.'-]{1,19})\s+(\d{4}[A-Za-z]?)(?![0-9])/

export function parseCourse(title: string): CalendarEvent['course'] {
  const m = COURSE_RE.exec(title)
  if (!m) return null
  const subject = m[1]
  const number = m[2]
  return { code: `${subject} ${number}`, subject, number }
}

/* ── fetching ──────────────────────────────────────────────────────────── */

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export class CalendarError extends Error {
  /** True when the token is dead and the user should reconnect. */
  needsReauth: boolean

  constructor(message: string, needsReauth = false) {
    super(message)
    this.name = 'CalendarError'
    this.needsReauth = needsReauth
  }
}

/** Fetch the next `HORIZON_DAYS` of events from the primary calendar. */
export async function fetchEvents(accessToken: string, now = new Date()): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: startOfDay(now).toISOString(),
    timeMax: addDays(startOfDay(now), HORIZON_DAYS).toISOString(),
    // Expand recurring events into individual occurrences.
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })

  const response = await fetch(`${API}/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new CalendarError('Calendar access expired — reconnect to refresh it.', true)
    }
    throw new CalendarError(`Calendar returned ${response.status}.`)
  }

  const body = (await response.json()) as { items?: ApiEvent[] }

  return (body.items ?? [])
    .filter((e) => e.status !== 'cancelled')
    // All-day events have `date` rather than `dateTime`; they have no place on
    // an hour-by-hour timeline and no duration to count toward the day.
    .filter((e) => Boolean(e.start?.dateTime && e.end?.dateTime))
    .map((e) => {
      const title = e.summary?.trim() ?? '(no title)'
      return {
        id: e.id,
        title,
        location: e.location?.trim() ?? '',
        start: new Date(e.start!.dateTime!),
        end: new Date(e.end!.dateTime!),
        course: parseCourse(title),
      }
    })
}

/* ── shaping ───────────────────────────────────────────────────────────── */

/** `9:30`, `2:00` — the design's gutter style, no meridiem. */
function timeLabel(d: Date): string {
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000

const round = (n: number) => Math.round(n * 10) / 10

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export const eventsOn = (events: CalendarEvent[], day: Date) =>
  events.filter((e) => isSameDay(e.start, day))

/**
 * Today's events as timeline slots.
 *
 * The day's first class takes the hero treatment, other classes the quieter
 * card, and anything in the evening that isn't a class takes the filled block.
 * Everything else is a plain line.
 */
export function toSchedule(events: CalendarEvent[]): Slot[] {
  const firstClass = events.find((e) => e.course)

  return events.map((e): Slot => {
    const time = timeLabel(e.start)

    if (e.course && e === firstClass) {
      return {
        kind: 'feature',
        id: e.id,
        time,
        where: e.location || e.course.code,
        seq: '',
        title: e.title,
        facts: [],
      }
    }
    if (e.course) {
      return {
        kind: 'minor',
        id: e.id,
        time,
        where: e.location || e.course.code,
        seq: '',
        title: e.title,
        note: '',
      }
    }
    if (e.start.getHours() >= 17) {
      return {
        kind: 'highlight',
        id: e.id,
        time,
        kicker: e.location.toUpperCase(),
        title: e.title,
        note: '',
      }
    }
    return { kind: 'plain', id: e.id, time, title: e.title, note: e.location }
  })
}

/** Hours spent in class, in everything else, and left over. */
export function toAllocation(events: CalendarEvent[]): AllocSegment[] {
  let inClass = 0
  let elsewhere = 0
  for (const e of events) {
    const hours = hoursBetween(e.start, e.end)
    if (e.course) inClass += hours
    else elsewhere += hours
  }

  const waking = DAY_END_HOUR - DAY_START_HOUR
  const unclaimed = Math.max(0, waking - inClass - elsewhere)

  return [
    { label: 'CLASS', hours: round(inClass), color: 'var(--color-accent-900)' },
    { label: 'EVERYTHING ELSE', hours: round(elsewhere), color: 'var(--color-accent)' },
    { label: 'UNCLAIMED', hours: round(unclaimed), color: null },
  ].filter((s) => s.hours > 0)
}

/** Headline figures for the brief. Derived only — never authored. */
export function toChips(allocation: AllocSegment[], classCount: number): Chip[] {
  const chips: Chip[] = []
  const unclaimed = allocation.find((s) => s.label === 'UNCLAIMED')
  if (unclaimed) chips.push({ label: `${unclaimed.hours}H FREE`, tone: 'solid' })
  if (classCount > 0) {
    chips.push({ label: `${classCount} ${classCount === 1 ? 'CLASS' : 'CLASSES'}`, tone: 'outline' })
  }
  return chips
}

/** A plain factual read on the day. No interpretation. */
export function toLede(todays: CalendarEvent[]): string | null {
  if (todays.length === 0) return null
  const classes = todays.filter((e) => e.course)
  const first = todays[0]
  const parts = [`${todays.length} ${todays.length === 1 ? 'block' : 'blocks'}`]
  if (classes.length) parts.push(`${classes.length} of them class`)
  return `${parts.join(', ')}. First at ${timeLabel(first.start)}.`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The course list, built from every class occurrence in the horizon.
 *
 * `meets` is the observed pattern — the weekdays and start time actually seen —
 * rather than anything the calendar states outright. `progress` stays 0 because
 * the term's length is unknowable from a two-week window, and the view hides
 * the bar rather than drawing a made-up one.
 */
export function toCourses(events: CalendarEvent[], today: Date): Course[] {
  const byCode = new Map<string, { course: NonNullable<CalendarEvent['course']>; seen: CalendarEvent[] }>()

  for (const e of events) {
    if (!e.course) continue
    const entry = byCode.get(e.course.code)
    if (entry) entry.seen.push(e)
    else byCode.set(e.course.code, { course: e.course, seen: [e] })
  }

  return [...byCode.values()]
    .map(({ course, seen }): Course => {
      const days = [...new Set(seen.map((e) => e.start.getDay()))].sort()
      const times = [...new Set(seen.map((e) => timeLabel(e.start)))]
      const meets = `${days.map((d) => WEEKDAYS[d]).join(' ')} ${times[0] ?? ''}`.trim()
      const room = seen.find((e) => e.location)?.location ?? ''

      return {
        code: course.code,
        name: room,
        meets,
        progress: 0,
        today: seen.some((e) => isSameDay(e.start, today)),
        facts: [],
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code))
}

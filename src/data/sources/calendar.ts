/**
 * Google Calendar → the dashboard's shapes.
 *
 * Pure functions over events the Worker already fetched. Where the calendar
 * cannot know something — a lecture's topic, how far through the term a course
 * is — the field is left empty rather than guessed, and the views hide it.
 */
import type { AllocSegment, Chip, Slot } from '../types'

/** The window the "unclaimed hours" figure is measured against: 08:00–24:00. */
const DAY_START_HOUR = 8
const DAY_END_HOUR = 24

/** After this, a non-class block is what the evening is *for*. */
const EVENING_HOUR = 17

export interface CalendarEvent {
  id: string
  title: string
  location: string
  /** The calendar this came from. */
  calendar: string
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
 *
 * The subject must be capitalised, which is what stops ordinary events like
 * `Pay rent 2026` from being read as a course.
 */
const COURSE_RE = /(?:^|[^A-Za-z])([A-Z][A-Za-z&.'-]{1,19})\s+(\d{4})([A-Za-z]?)(?![0-9])/

/** Years look exactly like catalogue numbers, so nearby ones are not courses. */
const YEAR_SPAN = 6

/**
 * Which course an event belongs to.
 *
 * The calendar name wins over the event title, because on this account each
 * course has its own calendar and the calendar is therefore a *statement* of
 * which course an event is, where a title is only evidence. It also rescues
 * events whose titles carry no code at all — a lecture called "Midterm review"
 * on the Econ 2122 calendar is still Econ 2122.
 *
 * The title remains the fallback, for a class sitting on a personal calendar.
 */
export function courseOf(
  calendarName: string,
  title: string,
  now: Date = new Date(),
): CalendarEvent['course'] {
  return parseCourse(calendarName, now) ?? parseCourse(title, now)
}

export function parseCourse(title: string, now: Date = new Date()): CalendarEvent['course'] {
  const m = COURSE_RE.exec(title)
  if (!m) return null

  const [, subject, digits, suffix] = m

  // `Reading Week 2026` is not a course; `Econ 2122` is.
  const asNumber = Number(digits)
  const year = now.getFullYear()
  if (!suffix && asNumber >= year - YEAR_SPAN && asNumber <= year + YEAR_SPAN) return null

  const number = `${digits}${suffix}`
  return { code: `${subject} ${number}`, subject, number }
}

/**
 * Normalise a course code for comparison across sources.
 *
 * The calendar writes `Econ 2122`, a Desktop folder might be `econ  2122` or
 * `ECON2122`. Case and inner spacing are the only differences worth forgiving —
 * the subject and number themselves must still match exactly.
 */
export const codeKey = (code: string) => code.toLowerCase().replace(/\s+/g, '')

/* ── shaping ───────────────────────────────────────────────────────────── */

/** `9:30`, `2:00` — the design's gutter style, no meridiem. */
export function timeLabel(d: Date): string {
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}`
}

const round = (n: number) => Math.round(n * 10) / 10

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export const eventsOn = (events: CalendarEvent[], day: Date) =>
  events.filter((e) => isSameDay(e.start, day))

/** What the syllabus says today's class is about, keyed by `codeKey`. */
export interface TopicLookup {
  get(code: string): { week: number; topic: string; readings?: string } | undefined
}

/**
 * Today's events as timeline slots.
 *
 * The day's first class takes the hero treatment, other classes the quieter
 * card, and the first evening block that isn't a class takes the filled one.
 * Everything else is a plain line.
 *
 * `topics` fills in `seq` and `facts`, which the design reserved for a syllabus
 * from the beginning and which were empty until one existed.
 */
export function toSchedule(events: CalendarEvent[], topics?: TopicLookup): Slot[] {
  const firstClass = events.find((e) => e.course)
  // Exactly one evening block gets the filled treatment. Without this, a day
  // ending with a bedtime marker at 23:30 gave the marker the same visual
  // weight as the thing the evening was actually for.
  const evening = events.find((e) => !e.course && e.start.getHours() >= EVENING_HOUR)

  return events.map((e): Slot => {
    const time = timeLabel(e.start)
    const lecture = e.course ? topics?.get(codeKey(e.course.code)) : undefined
    const seq = lecture ? `WEEK ${lecture.week}` : ''

    if (e.course && e === firstClass) {
      return {
        kind: 'feature',
        id: e.id,
        time,
        where: e.location || e.course.code,
        seq,
        title: e.title,
        facts: lecture
          ? [
              { label: 'TOPIC', text: lecture.topic },
              ...(lecture.readings ? [{ label: 'READINGS', text: `Ch ${lecture.readings}` }] : []),
            ]
          : [],
      }
    }
    if (e.course) {
      return {
        kind: 'minor',
        id: e.id,
        time,
        where: e.location || e.course.code,
        seq,
        title: e.title,
        note: lecture?.topic ?? '',
      }
    }
    if (e === evening) {
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

/**
 * How much of an event falls inside the measured day.
 *
 * Counting an event's full duration was wrong in both directions: a 07:45 alarm
 * contributed a quarter hour to a window that opens at 08:00, and anything
 * running past midnight was credited time the window never had. Clipping keeps
 * the segments and the "unclaimed" remainder describing the same 16 hours.
 */
function hoursInsideDay(e: CalendarEvent): number {
  const open = new Date(e.start)
  open.setHours(DAY_START_HOUR, 0, 0, 0)
  const close = new Date(e.start)
  close.setHours(0, 0, 0, 0)
  close.setDate(close.getDate() + 1)
  if (DAY_END_HOUR < 24) close.setHours(DAY_END_HOUR, 0, 0, 0)

  const from = Math.max(e.start.getTime(), open.getTime())
  const to = Math.min(e.end.getTime(), close.getTime())
  return Math.max(0, (to - from) / 3_600_000)
}

/** Hours spent in class, in everything else, and left over. */
export function toAllocation(events: CalendarEvent[]): AllocSegment[] {
  let inClass = 0
  let elsewhere = 0
  for (const e of events) {
    const hours = hoursInsideDay(e)
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

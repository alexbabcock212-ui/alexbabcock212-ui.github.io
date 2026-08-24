/**
 * Which week of term it is.
 *
 * Needed to line a syllabus up with a date. Deliberately week-relative rather
 * than date-driven: a syllabus is often last year's, so its *topics* are right
 * while its dates are a year out. Week numbers survive that; dates do not.
 *
 * The term's own dates come from `~/Desktop/Courses/term.json`, baked in by
 * `npm run scan`, because nothing the calendar exposes says where a term begins.
 */
import { localDate } from './tasks'

export interface Term {
  /** `YYYY-MM-DD`. */
  start: string
  end: string
}

const MS_PER_WEEK = 7 * 86_400_000

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * The 1-based week of term containing `now`, or null outside it.
 *
 * Week 1 is the week *containing* the start date, counted from that date rather
 * than from a Monday: a term that opens on a Wednesday still calls that week 1.
 */
export function currentWeek(term: Term | null, now: Date = new Date()): number | null {
  if (!term) return null

  const start = localDate(term.start)
  const end = localDate(term.end)
  if (!start || !end) return null

  const today = startOfDay(now)
  if (today < startOfDay(start) || today > startOfDay(end)) return null

  return Math.floor((today.getTime() - startOfDay(start).getTime()) / MS_PER_WEEK) + 1
}

/** The topic for a given week, if the syllabus covers it. */
export function topicForWeek(
  lectures: { week: number; topic: string }[],
  week: number | null,
): string | null {
  if (week === null) return null
  return lectures.find((l) => l.week === week)?.topic ?? null
}

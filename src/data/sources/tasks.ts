/**
 * Google Tasks and all-day calendar entries → the DUE screen.
 *
 * Both are folded into one list because that is how a deadline is actually
 * experienced: it makes no difference whether an essay was typed into Tasks or
 * dropped onto the calendar as an all-day block — it is due on Tuesday either
 * way.
 */
import type { RawAllDay, RawTask } from '../payload'
import type { Deadline } from '../types'
import { parseCourse } from './calendar'

/** Anything landing inside this many days is called out. */
const URGENT_DAYS = 2

/** How far ahead the screen looks — matched to the Worker's fetch horizon. */
const HORIZON_DAYS = 14

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/**
 * `2026-09-03` → that day, locally.
 *
 * Both sources give a bare calendar date. Passing one to `new Date()` parses it
 * as UTC midnight, which lands on the previous day for anyone west of Greenwich
 * — so the parts are split out and handed to the local-time constructor.
 */
export function localDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Whole days from today to `due`; negative when it has already passed. */
export function daysUntil(due: Date, now: Date): number {
  return Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000)
}

/** The short form in the right-hand column. Upper case, at most two words. */
export function whenLabel(due: Date | null, now: Date): string {
  if (!due) return 'NO DATE'

  const days = daysUntil(due, now)
  if (days < 0) return days === -1 ? '1 DAY LATE' : `${-days} DAYS LATE`
  if (days === 0) return 'TODAY'
  if (days === 1) return 'TOMORROW'
  if (days < 7) return DAYS[due.getDay()]
  return `${due.getDate()} ${MONTHS[due.getMonth()]}`
}

/**
 * Everything open, soonest first.
 *
 * Undated tasks are kept rather than dropped — an unscheduled to-do is still
 * work — but they sort to the bottom, behind everything that has a date.
 * Anything further out than the horizon is dropped: the screen says "next 14
 * days" and should mean it.
 */
export function toDeadlines(
  tasks: RawTask[],
  allDay: RawAllDay[],
  now: Date = new Date(),
): Deadline[] {
  const fromTasks = tasks.map((t): Deadline => {
    const due = t.due ? localDate(t.due) : null
    const course = parseCourse(t.title, now)
    return {
      id: `task:${t.id}`,
      course: course?.code ?? t.list.toUpperCase(),
      title: t.title,
      note: t.notes,
      when: whenLabel(due, now),
      urgent: due !== null && daysUntil(due, now) <= URGENT_DAYS,
      at: due?.getTime() ?? null,
    }
  })

  const fromCalendar = allDay.flatMap((e): Deadline[] => {
    const due = localDate(e.date)
    if (!due) return []
    const course = parseCourse(e.title, now)
    return [
      {
        id: `allday:${e.id}`,
        course: course?.code ?? 'CALENDAR',
        title: e.title,
        note: '',
        when: whenLabel(due, now),
        urgent: daysUntil(due, now) <= URGENT_DAYS,
        at: due.getTime(),
      },
    ]
  })

  return [...fromTasks, ...fromCalendar]
    .filter((d) => d.at === null || daysUntil(new Date(d.at), now) <= HORIZON_DAYS)
    .sort((a, b) => {
      if (a.at === b.at) return a.title.localeCompare(b.title)
      if (a.at === null) return 1
      if (b.at === null) return -1
      return a.at - b.at
    })
}

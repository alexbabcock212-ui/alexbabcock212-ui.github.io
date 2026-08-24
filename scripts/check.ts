/**
 * Checks for the pure data-shaping logic.
 *
 * There is no browser or device available in this environment, so these are
 * the only automated verification the Calendar mapping gets. Run with
 * `npm run check`.
 */
import {
  parseCourse,
  toAllocation,
  toChips,
  toCourses,
  toLede,
  toSchedule,
} from '../src/data/google/calendar'
import type { CalendarEvent } from '../src/data/google/calendar'
import { freshness } from '../src/data/dashboard'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}` +
      (ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`),
  )
}

const NOW = new Date(2026, 7, 24, 15, 0)

console.log('— course parsing —')
for (const t of ['Classics 2440', 'Econ 2122', 'Econ 2150', 'Mos 2310', 'History 2121']) {
  eq(`"${t}"`, parseCourse(t, NOW)?.code, t)
}
eq('trailing section', parseCourse('Econ 2122 - 001 LEC', NOW)?.code, 'Econ 2122')
eq('parenthesised', parseCourse('Managerial Accounting (Mos 2310)', NOW)?.code, 'Mos 2310')
eq('with room', parseCourse('History 2121 SSC 2050', NOW)?.code, 'History 2121')
eq('lettered number', parseCourse('Econ 2122B', NOW)?.code, 'Econ 2122B')

console.log('— things that are not courses —')
eq('plain event', parseCourse('Dentist appointment', NOW), null)
eq('lowercase + year', parseCourse('Pay rent 2026', NOW), null)
eq('capitalised + year', parseCourse('Reading Week 2026', NOW), null)
eq('next year', parseCourse('Grad trip 2027', NOW), null)
eq('a real course near a year is still lost', parseCourse('Econ 2026', NOW), null)

const at = (h: number, m = 0) => new Date(2026, 7, 24, h, m, 0, 0)
const ev = (id: string, title: string, h: number, endH: number, location = ''): CalendarEvent => ({
  id,
  title,
  location,
  start: at(h),
  end: at(endH),
  course: parseCourse(title, NOW),
})

const today = [
  ev('a', 'Econ 2122', 9, 10, 'SSC 2050'),
  ev('b', 'Gym', 12, 13),
  ev('c', 'Mos 2310', 14, 15, 'NCB 113'),
  ev('d', 'Dinner with Sam', 18, 20),
]

console.log('— timeline —')
const slots = toSchedule(today)
eq('first class is the hero', [slots[0].kind, slots[0].time], ['feature', '9:00'])
eq('other classes are quieter', slots[2].kind, 'minor')
eq('midday non-class is plain', slots[1].kind, 'plain')
eq('evening non-class is filled', slots[3].kind, 'highlight')
eq('ids unique', new Set(slots.map((s) => s.id)).size, 4)

console.log('— hours —')
const alloc = toAllocation(today)
eq('class', alloc.find((a) => a.label === 'CLASS')?.hours, 2)
eq('everything else', alloc.find((a) => a.label === 'EVERYTHING ELSE')?.hours, 3)
eq('unclaimed of a 16h day', alloc.find((a) => a.label === 'UNCLAIMED')?.hours, 11)
eq('chips', toChips(alloc, 2).map((c) => c.label), ['11H FREE', '2 CLASSES'])
eq('lede', toLede(today), '4 blocks, 2 of them class. First at 9:00.')
eq('empty day', toLede([]), null)

console.log('— courses —')
const courses = toCourses(
  [...today, ev('e', 'Econ 2122', 9, 10, 'SSC 2050'), ev('f', 'Classics 2440', 11, 12)],
  at(9),
)
eq('distinct only', courses.map((c) => c.code), ['Classics 2440', 'Econ 2122', 'Mos 2310'])
eq('no invented progress', courses.every((c) => c.progress === 0), true)
eq('no invented facts', courses.every((c) => c.facts.length === 0), true)
eq('room is the subtitle', courses.find((c) => c.code === 'Econ 2122')?.name, 'SSC 2050')
eq('meets today', courses.find((c) => c.code === 'Econ 2122')?.today, true)

console.log('— freshness —')
eq('same day', freshness(new Date(2026, 7, 24, 8, 14).getTime(), NOW), 'read at 8:14 AM')
eq('yesterday', freshness(new Date(2026, 7, 23, 8, 0).getTime(), NOW), 'read yesterday')
eq('older', freshness(new Date(2026, 7, 20, 8, 0).getTime(), NOW), 'read 4 days ago')

console.log(fails === 0 ? '\nAll passed.' : `\n${fails} FAILED`)
if (fails > 0) process.exit(1)

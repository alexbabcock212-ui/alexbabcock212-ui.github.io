/**
 * Checks for the pure data-shaping logic.
 *
 * There is no browser or device available in this environment, so these are the
 * only automated verification the Google mappings get. Run with `npm run check`.
 */
import {
  parseCourse,
  codeKey,
  courseOf,
  toAllocation,
  toChips,
  toLede,
  toSchedule,
} from '../src/data/sources/calendar'
import type { CalendarEvent } from '../src/data/sources/calendar'
import { sortSections, toCourses } from '../src/data/sources/courses'
import { daysUntil, localDate, toDeadlines, whenLabel } from '../src/data/sources/tasks'
import { agoLabel, normalise, toBrief, toGroups } from '../src/data/sources/markets'
import { loadCachedPayload } from '../src/data/cache'
import { isStale, lastMorning, nextMorning } from '../src/data/morning'
import { currentWeek, topicForWeek } from '../src/data/sources/term'
import { freshness } from '../src/data/dashboard'
// @ts-expect-error - plain JS helper, deliberately untyped
import {
  deckScore,
  outlineDeck,
  findAssessments,
  findSchedule,
  mergeLectures,
} from './lib/syllabus.mjs'
import type { CourseFolder } from '../src/data/types'

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

console.log('— which course an event belongs to —')
eq('the calendar names it', courseOf('Econ 2122', 'Midterm review', NOW)?.code, 'Econ 2122')
eq('even when the title also names one', courseOf('Econ 2122', 'Mos 2310 makeup', NOW)?.code, 'Econ 2122')
eq('the title is the fallback', courseOf('', 'Mos 2310 lecture', NOW)?.code, 'Mos 2310')
eq('a personal calendar names nothing', courseOf('Sleep', 'Wake Up', NOW), null)
eq('nor does an email address', courseOf('alex@gmail.com', 'Haircut', NOW), null)

console.log('— matching a folder to a calendar event —')
eq('case and spacing forgiven', codeKey('econ  2122'), codeKey('Econ 2122'))
eq('different courses stay different', codeKey('Econ 2122') === codeKey('Econ 2123'), false)

const at = (h: number, m = 0) => new Date(2026, 7, 24, h, m, 0, 0)
const ev = (
  id: string,
  title: string,
  h: number,
  endH: number,
  location = '',
  calendar = '',
): CalendarEvent => ({
  id,
  title,
  location,
  calendar,
  start: at(h),
  end: at(endH),
  course: courseOf(calendar, title, NOW),
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

console.log('— courses from the calendar —')
const courses = toCourses(
  [...today, ev('e', 'Econ 2122', 9, 10, 'SSC 2050'), ev('f', 'Classics 2440', 11, 12)],
  at(9),
)
eq('distinct only', courses.map((c) => c.code), ['Classics 2440', 'Econ 2122', 'Mos 2310'])
eq('no invented progress', courses.every((c) => c.progress === 0), true)
eq('no invented facts', courses.every((c) => c.facts.length === 0), true)
eq('room is the subtitle', courses.find((c) => c.code === 'Econ 2122')?.name, 'SSC 2050')
eq('meets today', courses.find((c) => c.code === 'Econ 2122')?.today, true)
eq('no folder unless scanned', courses.every((c) => c.folder === null), true)

console.log('— courses from the Desktop —')
const folder = (code: string, sections: string[]): CourseFolder => ({
  code,
  folder: code,
  sections,
  materials: sections.map((s) => ({
    name: `${s}.pdf`,
    section: s,
    kind: 'pdf' as const,
    modified: 1,
  })),
  fileCount: sections.length,
  updated: 1,
  lectures: [],
  lecturesSource: 'none' as const,
})

const merged = toCourses(today, at(9), [folder('econ 2122', ['Week 1']), folder('Stats 2244', [])])
eq('folder attaches across case', merged.find((c) => c.code === 'Econ 2122')?.folder?.folder, 'econ 2122')
eq('a folder with no classes is still a course', merged.map((c) => c.code), [
  'Econ 2122',
  'Mos 2310',
  'Stats 2244',
])
eq('and says so', merged.find((c) => c.code === 'Stats 2244')?.meets, '')
eq('a class with no folder is fine', merged.find((c) => c.code === 'Mos 2310')?.folder, null)

console.log('— section order —')
eq(
  'the order a term is lived in',
  sortSections(['Week 10', 'Final', 'Week 2', 'Course Info', 'Midterms', 'Week 1', 'Quizs']),
  ['Course Info', 'Week 1', 'Week 2', 'Week 10', 'Quizs', 'Midterms', 'Final'],
)
eq('loose files sort last', sortSections(['', 'Week 1']), ['Week 1', ''])

console.log('— due dates —')
// The bug this guards: `new Date('2026-09-03')` is UTC midnight, which is
// 3 Sep 00:00Z = 2 Sep 20:00 in Toronto. It must still read as the 3rd.
eq('a bare date is local', localDate('2026-09-03')?.getDate(), 3)
eq('so is an RFC 3339 one from Tasks', localDate('2026-09-03T00:00:00.000Z')?.getMonth(), 8)
eq('same day is zero', daysUntil(new Date(2026, 7, 24, 1, 0), NOW), 0)
eq('tomorrow is one', daysUntil(new Date(2026, 7, 25, 23, 0), NOW), 1)
eq('today', whenLabel(new Date(2026, 7, 24), NOW), 'TODAY')
eq('tomorrow', whenLabel(new Date(2026, 7, 25), NOW), 'TOMORROW')
eq('this week', whenLabel(new Date(2026, 7, 27), NOW), 'THU')
eq('further out', whenLabel(new Date(2026, 8, 3), NOW), '3 SEP')
eq('overdue', whenLabel(new Date(2026, 7, 21), NOW), '3 DAYS LATE')
eq('undated', whenLabel(null, NOW), 'NO DATE')

const deadlines = toDeadlines(
  [
    { id: '1', title: 'Essay for History 2121', notes: '', due: '2026-08-27T00:00:00.000Z', list: 'School' },
    { id: '2', title: 'Book flights', notes: '', due: null, list: 'Life' },
    { id: '3', title: 'Problem set', notes: 'Ch 4', due: '2026-08-25T00:00:00.000Z', list: 'School' },
    { id: '4', title: 'Way out', notes: '', due: '2026-12-01T00:00:00.000Z', list: 'School' },
  ],
  [{ id: 'x', title: 'Mos 2310 midterm', date: '2026-08-24' }],
  NOW,
)
eq('soonest first, undated last', deadlines.map((d) => d.title), [
  'Mos 2310 midterm',
  'Problem set',
  'Essay for History 2121',
  'Book flights',
])
eq('past the horizon is dropped', deadlines.some((d) => d.title === 'Way out'), false)
eq('a course code in the title wins', deadlines[2].course, 'History 2121')
eq('otherwise the list names it', deadlines[1].course, 'SCHOOL')
eq('near ones are urgent', [deadlines[0].urgent, deadlines[1].urgent], [true, true])
eq('undated ones are not', deadlines[3].urgent, false)
eq('all-day events are folded in', deadlines[0].id.startsWith('allday:'), true)

console.log('— markets —')
const quote = (symbol: string, price: number, previousClose: number, spark: number[] = []) => ({
  symbol,
  price,
  previousClose,
  spark,
  at: new Date(2026, 7, 27, 16, 0).getTime(),
})

const groups = toGroups([
  quote('^GSPC', 7730.99, 7675.7, [1, 2, 3, 4, 5]),
  quote('^IXIC', 26541.35, 26130.2),
  quote('^DJI', 53569.44, 53463.88),
  quote('^RUT', 3014.34, 3005.9),
  quote('^GSPTSE', 36834.25, 36813.65),
  quote('^TNX', 4.672, 4.664),
  quote('CAD=X', 1.3852, 1.3872),
  quote('CL=F', 83.63, 85.01),
  quote('ZZZ', 1, 1),
])
eq('bands come out in board order', groups.map((g) => g.title), [
  'NORTH AMERICA',
  'RATES, RISK & THE DOLLAR',
  'COMMODITIES & CRYPTO',
])
eq('a symbol the board does not know is dropped', groups.flatMap((g) => g.quotes).length, 8)
eq('levels are grouped and rounded', groups[0].quotes[0].value, '7,730.99')
eq('the move carries its sign', groups[0].quotes[0].change, '+55.29')
eq('so does the percent', groups[0].quotes[0].percent, '+0.72%')
eq('a fall reads as a fall', groups[2].quotes[0].direction, 'down')
eq('and uses a real minus', groups[2].quotes[0].percent, '−1.62%')
eq('breadth is counted, not asserted', groups[0].meta, '5 UP')
eq('a yield moves in basis points', groups[1].quotes[0].change, '+0.8 bp')
eq('and keeps its unit on the level', groups[1].quotes[0].value, '4.67%')
eq('a percent of a percent is never shown', groups[1].quotes[0].percent, '')
eq('four decimals for a currency pair', groups[1].quotes[1].value, '1.3852')
eq('the last print is on the row', groups[0].quotes[0].time, '4:00 PM')

eq('a sparkline needs a shape to draw', normalise([1, 2, 3]), [])
eq('and is flattened onto 0-1', normalise([2, 4, 6, 8]), [0, 1 / 3, 2 / 3, 1])
eq('a flat session runs down the middle', normalise([5, 5, 5, 5]), [0.5, 0.5, 0.5, 0.5])

eq(
  'the brief is assembled from the rows',
  toBrief(groups),
  'All five North American indexes higher — S&P 500 +0.72%, S&P/TSX +0.06%. ' +
    'With the 10-year at 4.67%, the loonie at 1.3852 and crude at 83.63.',
)
eq('and says nothing when there is nothing', toBrief([]), null)

eq('headline ages read as labels', agoLabel(NOW.getTime() - 2 * 3_600_000, NOW), '2H AGO')
eq('a day old is yesterday', agoLabel(NOW.getTime() - 26 * 3_600_000, NOW), 'YESTERDAY')

console.log('— the payload cache —')
// A cache written by a build that predates a feed is the upgrade path every
// installed device takes, and reading `.ok` off a feed that is not there is a
// blank screen. Stand in for localStorage; there is none in this environment.
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

const CACHE_KEY = 'life-dashboard:payload'
const feed = { ok: true, items: [] }
const current = {
  fetchedAt: NOW.getTime(),
  calendar: feed,
  allDay: feed,
  tasks: feed,
  quotes: feed,
  headlines: feed,
}
const put = (payload: unknown) => store.set(CACHE_KEY, JSON.stringify(payload))

put(current)
eq('this build\'s shape is kept', loadCachedPayload(NOW.getTime()) !== null, true)

// Exactly what the previous release wrote: a mail feed, and no market ones.
put({ fetchedAt: NOW.getTime(), calendar: feed, allDay: feed, tasks: feed, mail: feed })
eq('a payload from an older build is discarded', loadCachedPayload(NOW.getTime()), null)

put({ ...current, quotes: undefined })
eq('so is one missing any single feed', loadCachedPayload(NOW.getTime()), null)

put({ ...current, fetchedAt: NOW.getTime() - 15 * 86_400_000 })
eq('and one older than the window', loadCachedPayload(NOW.getTime()), null)

store.clear()
eq('an empty cache is not an error', loadCachedPayload(NOW.getTime()), null)

console.log('— the 6:45 rule —')
const morningOf = (d: number, h: number, m = 0) => new Date(2026, 7, d, h, m)
eq('before 6:45 belongs to yesterday', lastMorning(morningOf(24, 6, 30)).getDate(), 23)
eq('after 6:45 belongs to today', lastMorning(morningOf(24, 6, 50)).getDate(), 24)
eq('next is tomorrow once past', nextMorning(morningOf(24, 7, 0)).getDate(), 25)
eq('next is today when early', nextMorning(morningOf(24, 5, 0)).getDate(), 24)
eq('never read is stale', isStale(null, NOW), true)
eq(
  'read before this morning is stale',
  isStale(morningOf(24, 6, 0).getTime(), morningOf(24, 8, 0)),
  true,
)
eq(
  'read after this morning is fresh',
  isStale(morningOf(24, 7, 55).getTime(), morningOf(24, 8, 0)),
  false,
)
eq('but not for long', isStale(morningOf(24, 7, 40).getTime(), morningOf(24, 8, 0)), true)

console.log('— the hour bar only counts hours the day actually has —')
// The window is 08:00-24:00, so an alarm at 07:45 and a block running past
// midnight are both partly outside it. Counting them whole was the bug.
const nightOwl = [
  ev('w', 'Wake Up', 7, 8),
  ev('c', 'Econ 2122', 9, 10, 'SSC 2050', 'Econ 2122'),
  ev('s', 'Sleep', 23, 25),
]
const clipped = toAllocation(nightOwl)
eq('an event before the window opens counts nothing', clipped.find((a) => a.label === 'EVERYTHING ELSE')?.hours, 1)
eq('class is unaffected', clipped.find((a) => a.label === 'CLASS')?.hours, 1)
eq('unclaimed is the honest remainder', clipped.find((a) => a.label === 'UNCLAIMED')?.hours, 14)

console.log('— only one evening block is the highlight —')
const evening = toSchedule([
  ev('gym', 'Rock Climbing', 19, 22),
  ev('bed', 'Sleep', 23, 24),
])
eq('the first one wins', evening[0].kind, 'highlight')
eq('a bedtime marker does not', evening[1].kind, 'plain')

console.log('— which week of term it is —')
const term = { start: '2026-09-07', end: '2026-12-04' }
eq('before term', currentWeek(term, new Date(2026, 8, 6)), null)
eq('the first day is week 1', currentWeek(term, new Date(2026, 8, 7)), 1)
eq('six days later is still week 1', currentWeek(term, new Date(2026, 8, 13)), 1)
eq('seven days later is week 2', currentWeek(term, new Date(2026, 8, 14)), 2)
eq('after term', currentWeek(term, new Date(2026, 11, 5)), null)
eq('no term at all', currentWeek(null, NOW), null)

const syllabus = [
  { week: 1, topic: 'Introduction' },
  { week: 3, topic: 'Demand and Supply' },
]
eq('a topic for the week', topicForWeek(syllabus, 3), 'Demand and Supply')
eq('a gap in the syllabus is not invented', topicForWeek(syllabus, 2), null)
eq('outside the term there is no topic', topicForWeek(syllabus, null), null)

console.log('— the timeline names the topic —')
const withTopic = toSchedule(
  [ev('a', 'Econ 2122 Lecture', 9, 10, 'SSC 2050', 'Econ 2122')],
  new Map([[codeKey('Econ 2122'), { week: 3, topic: 'Demand and Supply' }]]),
)
const hero = withTopic[0]
eq('the week shows on the hero slot', hero.kind === 'feature' && hero.seq, 'WEEK 3')
eq(
  'and so does the topic',
  hero.kind === 'feature' && hero.facts[0],
  { label: 'TOPIC', text: 'Demand and Supply' },
)
eq(
  'without a syllabus it stays empty',
  toSchedule([ev('a', 'Econ 2122', 9, 10, '', 'Econ 2122')])[0].kind === 'feature',
  true,
)

console.log('— reading a syllabus schedule —')
const SYLLABUS = [
  'week dates topic chapters',
  '1 Sep 05 Introduction 1',
  '2 Sep 10 and 12 The Economic Problem 2',
  'Oct 06 Midterm 1 1-4, 9',
  '3 Oct 08 and 10 Producer Theory 10',
  'Oct 14 to Oct 18 Reading Week —-',
].join('\n')

const schedule = findSchedule(SYLLABUS)
eq('every numbered row', schedule.length, 3)
eq('topic without its columns', schedule[1].topic, 'The Economic Problem')
eq('dates kept', schedule[1].dates, 'Sep 10 and 12')
eq('readings kept', schedule[1].readings, '2')
eq('an undated row is not given a week', schedule.map((l: { week: number }) => l.week), [1, 2, 3])

const dated = findAssessments(SYLLABUS)
eq('midterms and breaks are collected', dated.map((a: { label: string }) => a.label), [
  'Midterm 1',
  'Reading Week',
])
eq('with their dates', dated[0].dates, 'Oct 06')
eq('and the chapter column stripped', dated[0].label, 'Midterm 1')

console.log('— reading a lecture deck —')
// One page per slide, which is the whole point: in a deck the page is the
// unit of meaning, and merging the pages destroys the only structure it has.
const SUMMARY_DECK = [
  ['CS 2440A/B Alexander the Great', '(Dr. Bernd Steinbock)', 'Lecture 3: Historical Background II:', 'Greece 404-359 BC'].join('\n'),
  ['Main Questions', '• Was there ever peace between the poleis?'].join('\n'),
  ['Main Points', '• Models for achieving peace among the Greek poleis', '• Spartan supremacy (404-371 BC)', '• Theban hegemony (371-362 BC)'].join('\n'),
  ['Sparta’s Victory', '• body text'].join('\n'),
]
const summary = outlineDeck(SUMMARY_DECK)
eq('the lecture number off the title slide', summary.number, 3)
eq('and its real heading, wrap included', summary.title, 'Historical Background II: Greece 404-359 BC')
eq('the slide count', summary.slides, 4)
eq('the deck’s own summary wins', summary.source, 'summary')
eq('points, not questions, when it has both', summary.topics, [
  'Models for achieving peace among the Greek poleis',
  'Spartan supremacy (404-371 BC)',
  'Theban hegemony (371-362 BC)',
])

const SECTION_DECK = [
  'WEEK 1 – The Enlightenment',
  ['Periodization of Greek History', '• body'].join('\n'),
  ['Periodization of Greek History', '• more body'].join('\n'),
  ['The Rise of the Persian Empire', '• body'].join('\n'),
  '',
  ['• ➔ a stray bullet that is not a heading'].join('\n'),
  ['Questions?'].join('\n'),
  ['© 2025 Pearson Canada'].join('\n'),
]
const sections = outlineDeck(SECTION_DECK)
eq('with no summary slide, the headings are the outline', sections.source, 'sections')
eq('a section spanning slides is one topic', sections.topics, [
  'Periodization of Greek History',
  'The Rise of the Persian Empire',
])
eq('the title slide is the name, not a topic', sections.title, 'WEEK 1 – The Enlightenment')
eq('a deck that numbers nothing says so', sections.number, null)

eq('and it invents nothing', outlineDeck(['Just a title slide']).topics, [])

console.log('— picking the right file in a week folder —')
eq('a lecture beats an example set', deckScore('Chapter 6 Lecture.pdf') > deckScore('Chapter 05 examples.pdf'), true)
eq('solutions are never the deck', deckScore('HmwkSols.pdf') > deckScore('Unit 7 (PPT).pdf'), false)
eq('practice midterms score negative', deckScore('Midterm 1 Practice.pdf') < 0, true)

console.log('— lectures.tsv wins field by field —')
const onDisk = [
  { week: 1, topic: 'My own wording', readings: '', detail: 'What I wrote' },
  { week: 2, topic: '', readings: '', detail: '' },
]
const fresh = [
  { week: 1, topic: 'Introduction', readings: '1', detail: 'Parsed detail', dates: 'Sep 05' },
  { week: 2, topic: 'The Economic Problem', readings: '2', detail: 'More parsed', dates: 'Sep 10' },
]
const mergeResult = mergeLectures(onDisk, fresh)
const rows = mergeResult.merged
eq('a hand-written topic survives', rows[0].topic, 'My own wording')
eq('a hand-written detail survives', rows[0].detail, 'What I wrote')
eq('an empty field is filled in', rows[0].readings, '1')
eq('an empty row is filled in entirely', rows[1].topic, 'The Economic Problem')
eq('dates come from the parse, not the file', rows[0].dates, 'Sep 05')
eq('and it knows something changed', mergeResult.changed, true)

eq('re-merging the same thing changes nothing', mergeLectures(rows, fresh).changed, false)
eq('no file at all is just the parse', mergeLectures(null, fresh).merged.length, 2)

console.log('— freshness —')
eq('same day', freshness(new Date(2026, 7, 24, 8, 14).getTime(), NOW), 'read at 8:14 AM')
eq('yesterday', freshness(new Date(2026, 7, 23, 8, 0).getTime(), NOW), 'read yesterday')
eq('older', freshness(new Date(2026, 7, 20, 8, 0).getTime(), NOW), 'read 4 days ago')

console.log(fails === 0 ? '\nAll passed.' : `\n${fails} FAILED`)
if (fails > 0) process.exit(1)

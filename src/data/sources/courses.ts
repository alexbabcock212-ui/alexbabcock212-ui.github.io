/**
 * The course list, assembled from two sources that know different things.
 *
 * The calendar knows *when* a course meets and where. The Desktop folder knows
 * what is *in* it — slides, outlines, past midterms. Neither is complete on its
 * own, and either can be missing: before term starts there are folders and no
 * classes, and a course with no folder is still a course.
 */
import type { Course, CourseFolder, Material } from '../types'
import { currentWeek } from './term'
import type { Term } from './term'
import { codeKey, isSameDay, timeLabel } from './calendar'
import type { CalendarEvent } from './calendar'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* ── section ordering ──────────────────────────────────────────────────── */

/** Pull the number out of `Week 3`, `Unit 12`, `Midterm 1`. */
const numberIn = (name: string) => {
  const m = /(\d+)/.exec(name)
  return m ? Number(m[1]) : null
}

/**
 * The order a term is actually lived in.
 *
 * Course Info first because that is where the outline is, then the weeks and
 * units in sequence, then the assessments, with anything unrecognised sitting
 * between the two. Files loose at the folder root sort last: they are the ones
 * that were never filed.
 */
function rank(section: string): number {
  const s = section.toLowerCase()
  if (section === '') return 6
  if (s.includes('course info') || s.includes('outline') || s.includes('syllabus')) return 0
  if (s.startsWith('week')) return 1
  if (s.startsWith('unit') || s.startsWith('lecture') || s.startsWith('chapter')) return 2
  if (s.includes('quiz') || s.includes('assignment') || s.includes('lab')) return 3
  if (s.includes('midterm') || s.includes('test')) return 4
  if (s.includes('final') || s.includes('exam')) return 5
  return 3
}

/** Sections in teaching order. Exported so the render check can pin it down. */
export function sortSections(sections: string[]): string[] {
  return [...sections].sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    const na = numberIn(a)
    const nb = numberIn(b)
    if (na !== null && nb !== null && na !== nb) return na - nb
    return a.localeCompare(b, undefined, { numeric: true })
  })
}

/* ── folders ───────────────────────────────────────────────────────────── */

/** The scan, indexed by normalised code so `econ2122` finds `Econ 2122`. */
export function indexFolders(folders: CourseFolder[]): Map<string, CourseFolder> {
  return new Map(folders.map((f) => [codeKey(f.code), { ...f, sections: sortSections(f.sections) }]))
}

/** Materials grouped by section, in teaching order, newest first within each. */
export function groupMaterials(folder: CourseFolder): { section: string; items: Material[] }[] {
  const bySection = new Map<string, Material[]>()
  for (const m of folder.materials) {
    const list = bySection.get(m.section)
    if (list) list.push(m)
    else bySection.set(m.section, [m])
  }

  return sortSections([...bySection.keys()]).map((section) => ({
    section,
    items: bySection.get(section)!.sort((a, b) => b.modified - a.modified),
  }))
}

/* ── the list ──────────────────────────────────────────────────────────── */

/**
 * Every course, from the calendar and the Desktop both.
 *
 * `meets` is the *observed* pattern — the weekdays and start time actually seen
 * in the fetch window — rather than anything the calendar states outright, and
 * stays empty for a course seen only as a folder. `progress` stays 0 because a
 * two-week window cannot know the length of a term, and the view draws no bar
 * rather than a made-up one.
 */
export function toCourses(
  events: CalendarEvent[],
  today: Date,
  folders: CourseFolder[] = [],
  term: Term | null = null,
): Course[] {
  const index = indexFolders(folders)
  const week = currentWeek(term, today)
  const seen = new Map<string, { code: string; events: CalendarEvent[] }>()

  for (const e of events) {
    if (!e.course) continue
    const key = codeKey(e.course.code)
    const entry = seen.get(key)
    if (entry) entry.events.push(e)
    else seen.set(key, { code: e.course.code, events: [e] })
  }

  const scheduled = [...seen.entries()].map(([key, { code, events: occurrences }]): Course => {
    const days = [...new Set(occurrences.map((e) => e.start.getDay()))].sort()
    const times = [...new Set(occurrences.map((e) => timeLabel(e.start)))]
    const room = occurrences.find((e) => e.location)?.location ?? ''

    return {
      code,
      name: room,
      meets: `${days.map((d) => WEEKDAYS[d]).join(' ')} ${times[0] ?? ''}`.trim(),
      progress: 0,
      today: occurrences.some((e) => isSameDay(e.start, today)),
      facts: [],
      folder: index.get(key) ?? null,
      lectures: index.get(key)?.lectures ?? [],
      currentWeek: week,
    }
  })

  // A folder with no classes in the window is still a course you are taking —
  // which is the normal state of things in the week before term starts.
  const onCalendar = new Set(scheduled.map((c) => codeKey(c.code)))
  const folderOnly = [...index.entries()]
    .filter(([key]) => !onCalendar.has(key))
    .map(([, folder]): Course => ({
      code: folder.code,
      name: '',
      meets: '',
      progress: 0,
      today: false,
      facts: [],
      folder,
      lectures: folder.lectures,
      currentWeek: week,
    }))

  return [...scheduled, ...folderOnly].sort((a, b) => a.code.localeCompare(b.code))
}

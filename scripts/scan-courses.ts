/**
 * Read the term's course folders off the Desktop and bake them into the app.
 *
 * A web page cannot see a filesystem, and the Worker runs in a datacentre, so
 * this is the only place the scan can happen: on the Mac, at deploy time. The
 * result is a snapshot, not a live view — it is as current as the last deploy.
 *
 *   npm run scan            # ~/Desktop/Courses
 *   COURSES_DIR=… npm run scan
 *   COURSES_PRIVATE=1 npm run scan
 *
 * ── on what this publishes ──────────────────────────────────────────────
 * The output is bundled into a site served from a *public* GitHub Pages repo,
 * so every filename it records is world-readable. File *contents* never leave
 * the Mac, but the names do. `COURSES_PRIVATE=1` records only section names and
 * counts — enough for the screen to show a course's shape without listing what
 * is in it.
 */
import { readdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, extname, resolve } from 'node:path'
import { parseCourse } from '../src/data/sources/calendar'
import type {
  Assessment,
  CourseFolder,
  Lecture,
  LecturesSource,
  Material,
  MaterialKind,
} from '../src/data/types'
// @ts-expect-error - plain JS helper alongside this script, deliberately untyped
import {
  deckScore,
  extractObjectives,
  extractText,
  findAssessments,
  findSchedule,
  firstDateIn,
  mergeLectures,
  readLecturesFile,
  writeLecturesFile,
} from './lib/syllabus.mjs'

const ROOT = resolve(process.env.COURSES_DIR ?? join(homedir(), 'Desktop', 'Courses'))
const OUT = resolve(import.meta.dirname, '..', 'src', 'data', 'courses.generated.json')
const PRIVATE = process.env.COURSES_PRIVATE === '1'

/** Keeps one runaway folder from bloating the bundle. */
const MAX_MATERIALS = 400

/** Extensions worth naming. Anything else is `other`. */
const KINDS: Record<string, MaterialKind> = {
  '.pdf': 'pdf',
  '.ppt': 'slides',
  '.pptx': 'slides',
  '.key': 'slides',
  '.doc': 'doc',
  '.docx': 'doc',
  '.pages': 'doc',
  '.txt': 'doc',
  '.md': 'doc',
  '.rtf': 'doc',
  '.xls': 'sheet',
  '.xlsx': 'sheet',
  '.numbers': 'sheet',
  '.csv': 'data',
  '.json': 'data',
}

/**
 * Finder litter, Office lock files, anything hidden — and this tool's own
 * files, which are configuration rather than coursework and would otherwise
 * turn up in a course's materials list.
 */
const ignored = (name: string) =>
  name.startsWith('.') ||
  name.startsWith('~$') ||
  name === 'Icon\r' ||
  name === 'node_modules' ||
  name === 'lectures.tsv' ||
  name === 'term.json' ||
  name.toLowerCase() === 'readme.md'

const kindOf = (name: string): MaterialKind => KINDS[extname(name).toLowerCase()] ?? 'other'

interface Entry {
  name: string
  path: string
  isDir: boolean
}

function list(dir: string): Entry[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => !ignored(d.name))
      .map((d) => {
        const path = join(dir, d.name)
        // `isDirectory()` is false for a symlinked folder; stat resolves it.
        let isDir = d.isDirectory()
        if (d.isSymbolicLink()) {
          try {
            isDir = statSync(path).isDirectory()
          } catch {
            return null
          }
        }
        return { name: d.name, path, isDir }
      })
      .filter((e): e is Entry => e !== null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  } catch {
    return []
  }
}

/**
 * Every file under `dir`, all attributed to `section`.
 *
 * Deeper nesting is flattened rather than modelled: `Midterm 1/Results/x.pdf`
 * belongs, for the purposes of a phone screen, under `Midterm 1`.
 */
function collect(dir: string, section: string, out: Material[], depth = 0): void {
  if (out.length >= MAX_MATERIALS || depth > 4) return

  for (const entry of list(dir)) {
    if (out.length >= MAX_MATERIALS) return

    if (entry.isDir) {
      collect(entry.path, section, out, depth + 1)
      continue
    }

    let modified = 0
    try {
      modified = Math.round(statSync(entry.path).mtimeMs)
    } catch {
      continue
    }

    out.push({ name: entry.name, section, kind: kindOf(entry.name), modified })
  }
}

/** Filenames that look like a course outline rather than a lecture deck. */
const OUTLINE_RE = /(outline|syllabus|schedule|course\s*info|CO\d)/i

/** Decks big enough to be slow to open, and rarely more informative for it. */
const MAX_PDF_BYTES = 15 * 1024 * 1024

/**
 * A ceiling on how many PDFs are opened *per course*.
 *
 * Per course, not per scan: a single global budget let a 110-file first course
 * exhaust it and leave every course after it with nothing, which is a silent
 * and very confusing failure. Results are cached into lectures.tsv, so this
 * cost is paid once rather than on every scan.
 */
const MAX_EXTRACTIONS_PER_COURSE = 40
let extractions = 0

async function textOf(path: string): Promise<string | null> {
  if (extractions >= MAX_EXTRACTIONS_PER_COURSE) return null
  try {
    if (statSync(path).size > MAX_PDF_BYTES) return null
  } catch {
    return null
  }
  extractions++
  try {
    return (await extractText(path)) as string
  } catch {
    // Image-only or malformed: not an error, just nothing to read.
    return null
  }
}

/** `Week 3`, `Unit 12`, `Lecture 4` → 3, 12, 4. */
function sectionWeek(section: string): number | null {
  const m = /^(?:week|unit|lecture|module|topic)\s*#?\s*(\d{1,2})\b/i.exec(section.trim())
  return m ? Number(m[1]) : null
}

/**
 * What each week's own slides say they cover.
 *
 * One deck per week — the first that yields anything. Opening every file in a
 * folder of thirty would cost minutes for no extra signal.
 */
async function detailFromSlides(
  dir: string,
  materials: Material[],
): Promise<Map<number, { title: string; objectives: string }>> {
  const byWeek = new Map<number, Material[]>()
  for (const m of materials) {
    if (m.kind !== 'pdf') continue
    const week = sectionWeek(m.section)
    if (week === null) continue
    const list = byWeek.get(week)
    if (list) list.push(m)
    else byWeek.set(week, [m])
  }

  const out = new Map<number, { title: string; objectives: string }>()
  for (const [week, files] of byWeek) {
    // Score rather than pattern-match: a week's folder holds the deck next to
    // problem sets and solutions, and the wrong pick yields "The figure shows
    // the circular flow model" where the objectives slide was wanted.
    const ordered = [...files].sort((a, b) => deckScore(b.name) - deckScore(a.name))
    for (const file of ordered) {
      if (deckScore(file.name) < 0) break
      const text = await textOf(join(dir, file.section, file.name))
      if (!text) continue
      const found = extractObjectives(text) as { title: string; objectives: string }
      if (found.objectives || found.title) {
        out.set(week, found)
        break
      }
    }
  }
  return out
}

/**
 * Lecture topics and assessments for one course.
 *
 * Three layers, best available winning per field: what the user wrote in
 * `lectures.tsv`, what that week's slides say, and what the syllabus row says.
 * The file is rewritten only when parsing actually added something, so an
 * edited row is never disturbed.
 */
async function scanLectures(
  dir: string,
  materials: Material[],
): Promise<{
  lectures: Lecture[]
  source: LecturesSource
  assessments: Assessment[]
  firstDate: { month: string; day: number } | null
}> {
  extractions = 0
  const file = join(dir, 'lectures.tsv')
  const fromFile = readLecturesFile(file) as Lecture[] | null

  // The outline, for the schedule table and the assessment rows.
  let parsed: Lecture[] = []
  let assessments: Assessment[] = []
  let firstDate: { month: string; day: number } | null = null

  const pdfs = materials
    .filter((m) => m.kind === 'pdf')
    .sort((a, b) => Number(OUTLINE_RE.test(b.name)) - Number(OUTLINE_RE.test(a.name)))

  for (const pdf of pdfs) {
    const text = await textOf(join(dir, pdf.section, pdf.name))
    if (!text) continue
    const found = findSchedule(text) as Lecture[]
    if (found.length >= 3) {
      parsed = found
      assessments = findAssessments(text) as Assessment[]
      firstDate = firstDateIn(text) as { month: string; day: number } | null
      break
    }
  }

  // Then each week's own deck, which is where real detail comes from. The
  // deck's heading also stands in as a topic for a course with no syllabus
  // table — better than an empty row, and still the course's own words.
  const slides = await detailFromSlides(dir, materials)
  for (const lecture of parsed) {
    const found = slides.get(lecture.week)
    if (!found) continue
    lecture.topic ||= found.title
    lecture.detail ||= found.objectives
  }
  for (const [week, found] of slides) {
    if (parsed.some((l) => l.week === week)) continue
    parsed.push({
      week,
      topic: found.title,
      dates: '',
      readings: '',
      detail: found.objectives,
      detailSource: 'slides',
    })
  }
  parsed.sort((a, b) => a.week - b.week)

  const { merged, changed } = mergeLectures(fromFile, parsed) as {
    merged: Lecture[]
    changed: boolean
  }

  if (merged.length === 0) {
    return { lectures: [], source: 'none', assessments, firstDate }
  }

  if (changed) {
    writeLecturesFile(
      file,
      merged,
      fromFile
        ? 'Updated from your PDFs. Anything you had written was kept.'
        : 'Parsed from your PDFs. Check it — then edit as you like.',
    )
  }

  // Where each row's detail came from, so the screen can say so.
  const fileDetail = new Map((fromFile ?? []).map((l) => [l.week, l.detail]))
  for (const l of merged) {
    l.detailSource = !l.detail ? 'none' : fileDetail.get(l.week) ? 'file' : 'slides'
  }

  return { lectures: merged, source: fromFile ? 'file' : 'pdf', assessments, firstDate }
}

function scanCourse(dir: string, folderName: string, code: string): CourseFolder {
  const sections: string[] = []
  const materials: Material[] = []

  for (const entry of list(dir)) {
    if (entry.isDir) {
      sections.push(entry.name)
      collect(entry.path, entry.name, materials)
    } else {
      // Loose at the root of the course folder — section `''`.
      try {
        materials.push({
          name: entry.name,
          section: '',
          kind: kindOf(entry.name),
          modified: Math.round(statSync(entry.path).mtimeMs),
        })
      } catch {
        // Unreadable; skip it.
      }
    }
  }

  const updated = materials.length ? Math.max(...materials.map((m) => m.modified)) : null

  return {
    code,
    folder: folderName,
    sections,
    // In private mode the shape of the course still shows, but not its contents.
    materials: PRIVATE ? [] : materials,
    fileCount: materials.length,
    updated,
    lectures: [],
    lecturesSource: 'none',
    assessments: [],
  }
}

/* ── the term ──────────────────────────────────────────────────────────── */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

interface Term {
  start: string
  end: string
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Term dates, which nothing else can supply.
 *
 * The calendar knows when classes meet but not when the term begins, and the
 * distinction matters: "which week is it" is the question that lines a syllabus
 * up with today. A syllabus's own first date is the best available guess — with
 * *this* year substituted, because the syllabus is quite possibly last year's.
 */
function resolveTerm(
  root: string,
  guess: { month: string; day: number } | null,
  weeks: number,
): { term: Term; created: boolean } {
  const file = join(root, 'term.json')

  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Term
      if (parsed?.start && parsed?.end) return { term: parsed, created: false }
    } catch {
      // Malformed; fall through and rewrite it.
    }
  }

  const now = new Date()
  let start: Date
  if (guess) {
    const month = MONTHS.indexOf(guess.month)
    start = new Date(now.getFullYear(), month < 0 ? now.getMonth() : month, guess.day)
    // A term that already ended this year is next year's.
    if (start.getTime() < now.getTime() - 30 * 86_400_000) start.setFullYear(now.getFullYear() + 1)
  } else {
    start = now
  }

  const end = new Date(start)
  end.setDate(end.getDate() + Math.max(weeks, 12) * 7)

  const term: Term = { start: iso(start), end: iso(end) }
  writeFileSync(file, `${JSON.stringify(term, null, 2)}\n`)
  return { term, created: true }
}

/* ── run ───────────────────────────────────────────────────────────────── */

const courses: CourseFolder[] = []
let termGuess: { month: string; day: number } | null = null
let longestTerm = 0

if (!existsSync(ROOT)) {
  console.log(`No course folder at ${ROOT} — writing an empty list.`)
  console.log('Create it and name each course folder like "Econ 2122", then run again.')
} else {
  for (const entry of list(ROOT)) {
    if (!entry.isDir) continue
    const course = parseCourse(entry.name)
    if (!course) {
      console.log(`skip  ${entry.name}  (not a course code)`)
      continue
    }

    const scanned = scanCourse(entry.path, entry.name, course.code)

    const { lectures, source, assessments, firstDate } = await scanLectures(
      entry.path,
      scanned.materials,
    )
    scanned.lectures = lectures
    scanned.lecturesSource = source
    scanned.assessments = assessments
    termGuess ??= firstDate
    longestTerm = Math.max(longestTerm, ...lectures.map((l) => l.week), 0)

    courses.push(scanned)

    const withDetail = lectures.filter((l) => l.detail).length
    const topics =
      source === 'none'
        ? 'no syllabus'
        : `${lectures.length} weeks, ${withDetail} with detail` +
          (assessments.length ? `, ${assessments.length} dated` : '')
    console.log(
      `ok    ${scanned.code.padEnd(16)} ${String(scanned.fileCount).padStart(4)} files  ` +
        `${scanned.sections.length} sections  ${topics}`,
    )
  }
}

const { term, created } = resolveTerm(ROOT, termGuess, longestTerm)

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      scannedAt: Date.now(),
      root: ROOT.replace(homedir(), '~'),
      redacted: PRIVATE,
      term,
      courses: courses.sort((a, b) => a.code.localeCompare(b.code)),
    },
    null,
    2,
  )}\n`,
)

console.log(`\n${courses.length} course${courses.length === 1 ? '' : 's'} → src/data/courses.generated.json`)
console.log(`term: ${term.start} to ${term.end}${created ? '  (guessed — check ~/Desktop/Courses/term.json)' : ''}`)
if (!PRIVATE && courses.length > 0) {
  console.log('Note: these filenames ship in a public bundle. COURSES_PRIVATE=1 omits them.')
}

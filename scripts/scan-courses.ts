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
import type { CourseFolder, Lecture, LecturesSource, Material, MaterialKind } from '../src/data/types'
// @ts-expect-error - plain JS helper alongside this script, deliberately untyped
import {
  extractText,
  findSchedule,
  firstDateIn,
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
const OUTLINE_RE = /(outline|syllabus|schedule|course\s*info|^co\b|CO\d)/i

/**
 * Lecture topics for one course.
 *
 * `lectures.tsv` always wins. That is the whole safety mechanism: syllabus
 * layouts vary far too much for a parser to be trusted outright, so the parse
 * is only ever a *draft*, written once for a human to correct and never
 * overwritten afterwards.
 */
async function scanLectures(
  dir: string,
  materials: Material[],
): Promise<{ lectures: Lecture[]; source: LecturesSource; firstDate: { month: string; day: number } | null }> {
  const file = join(dir, 'lectures.tsv')

  const fromFile = readLecturesFile(file) as Lecture[] | null
  if (fromFile && fromFile.length > 0) {
    return { lectures: fromFile, source: 'file', firstDate: null }
  }

  // Outline-looking names first, then any other PDF as a fallback.
  const pdfs = materials
    .filter((m) => m.kind === 'pdf')
    .sort((a, b) => Number(OUTLINE_RE.test(b.name)) - Number(OUTLINE_RE.test(a.name)))

  for (const pdf of pdfs) {
    const path = join(dir, pdf.section, pdf.name)
    if (!existsSync(path)) continue
    try {
      const text: string = await extractText(path)
      const found = findSchedule(text) as Lecture[]
      if (found.length >= 3) {
        writeLecturesFile(file, found, `Parsed from ${pdf.name}. Check it — then edit as you like.`)
        return { lectures: found, source: 'pdf', firstDate: firstDateIn(text) }
      }
    } catch {
      // An unreadable or image-only PDF is not an error; the next one may work,
      // and a hand-written lectures.tsv always will.
    }
  }

  return { lectures: [], source: 'none', firstDate: null }
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

    const { lectures, source, firstDate } = await scanLectures(entry.path, scanned.materials)
    scanned.lectures = lectures
    scanned.lecturesSource = source
    termGuess ??= firstDate
    longestTerm = Math.max(longestTerm, ...lectures.map((l) => l.week), 0)

    courses.push(scanned)

    const topics =
      source === 'none'
        ? 'no syllabus'
        : `${lectures.length} weeks from ${source === 'file' ? 'lectures.tsv' : 'a PDF'}`
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

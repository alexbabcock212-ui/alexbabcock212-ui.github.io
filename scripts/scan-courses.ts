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
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, extname, resolve } from 'node:path'
import { parseCourse } from '../src/data/sources/calendar'
import type { CourseFolder, Material, MaterialKind } from '../src/data/types'

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

/** Finder litter, Office lock files, and anything hidden. */
const ignored = (name: string) =>
  name.startsWith('.') || name.startsWith('~$') || name === 'Icon\r' || name === 'node_modules'

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
  }
}

/* ── run ───────────────────────────────────────────────────────────────── */

const courses: CourseFolder[] = []

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
    courses.push(scanned)
    console.log(
      `ok    ${scanned.code.padEnd(16)} ${String(scanned.fileCount).padStart(4)} files  ` +
        `${scanned.sections.length} sections`,
    )
  }
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      scannedAt: Date.now(),
      root: ROOT.replace(homedir(), '~'),
      redacted: PRIVATE,
      courses: courses.sort((a, b) => a.code.localeCompare(b.code)),
    },
    null,
    2,
  )}\n`,
)

console.log(`\n${courses.length} course${courses.length === 1 ? '' : 's'} → src/data/courses.generated.json`)
if (!PRIVATE && courses.length > 0) {
  console.log('Note: these filenames ship in a public bundle. COURSES_PRIVATE=1 omits them.')
}

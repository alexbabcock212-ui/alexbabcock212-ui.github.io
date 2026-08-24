/**
 * Pull a week-by-week lecture schedule out of a course outline.
 *
 * Two things make this tractable. First, syllabus schedules are nearly always a
 * table with a week column, so the parse is anchored on a header row rather
 * than guessing at free text. Second — and this is what makes it *safe* — the
 * result is written to an editable `lectures.tsv` in the course folder, and
 * that file wins on every later scan. A bad parse is a five-minute correction,
 * made once, that never regresses.
 *
 * Topics are keyed by **week number, not date**, deliberately. A syllabus is
 * often last year's: the topics are right and the dates are a year out. Week
 * numbers survive that; dates do not.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

/* ── extraction ────────────────────────────────────────────────────────── */

/**
 * Text from a PDF.
 *
 * `unpdf` rather than a hand-rolled reader: pulling literal strings out of the
 * content streams ignores the font's ToUnicode map, which on this very file
 * turned "PRINCIPLES" into "P R I ! C I P LES".
 */
export async function extractText(path) {
  const { extractText: extract, getDocumentProxy } = await import('unpdf')
  const { readFile } = await import('node:fs/promises')
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)))
  const { text } = await extract(pdf, { mergePages: true })
  return text
}

/* ── parsing ───────────────────────────────────────────────────────────── */

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'

/** `Sep 10 and 12`, `Oct 14 to Oct 18`, `Sept. 3` — the whole date column. */
const DATES = new RegExp(
  `^\\s*${MONTH}\\s*\\d{1,2}` +
    `(?:\\s*(?:and|to|&|-|–|—|,)\\s*(?:${MONTH}\\s*)?\\d{1,2})*\\s*`,
  'i',
)

/** A trailing chapter/reading column: bare numbers, ranges, dashes. */
const TRAILING_REFS = /[\s,;]+(?:ch(?:apter)?s?\.?\s*)?[\d]+(?:\s*[-–—]\s*[\d]+)?(?:\s*,\s*[\d]+(?:\s*[-–—]\s*[\d]+)?)*\s*$/i

/** A row that is only punctuation once the columns are stripped. */
const EMPTY_ISH = /^[\s—–\-.·|]*$/

const clean = (s) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—\-|]+/, '')
    .replace(/[\s:–—\-|]+$/, '')
    .trim()

/**
 * Table form: a `week | dates | topic | chapters` header, then numbered rows.
 *
 * Rows without a leading week number — midterms, reading week — are skipped
 * rather than guessed at. They are real, but they are not lecture topics, and
 * inventing a week number for them would misalign everything after.
 */
function parseTable(lines) {
  const header = lines.findIndex(
    (l) => /\bweeks?\b/i.test(l) && /\btopics?\b/i.test(l) && l.length < 80,
  )
  if (header === -1) return []

  const out = []
  let misses = 0

  for (const raw of lines.slice(header + 1)) {
    const line = raw.trim()
    if (!line) continue

    const m = /^(\d{1,2})\b\s*(.*)$/.exec(line)
    if (!m) {
      // Undated rows (Reading Week, midterms) are expected inside the table;
      // a run of them means the table has ended.
      if (++misses > 4) break
      continue
    }

    const week = Number(m[1])
    if (week < 1 || week > 30) {
      if (++misses > 4) break
      continue
    }

    let rest = m[2].replace(DATES, '')
    rest = rest.replace(TRAILING_REFS, '')
    const topic = clean(rest)
    if (!topic || EMPTY_ISH.test(topic)) {
      if (++misses > 4) break
      continue
    }

    misses = 0
    // A repeated week number means we have run past the table into prose.
    if (out.some((l) => l.week === week)) break
    out.push({ week, topic })
  }

  return out
}

/** Inline form: `Week 3: Consumer choice`, `Week 3 — Consumer choice`. */
function parseInline(text) {
  const out = []
  const re = /\bweek\s*(\d{1,2})\s*[:–—\-.)]\s*([^\n]{3,90})/gi
  let m
  while ((m = re.exec(text)) !== null) {
    const week = Number(m[1])
    const topic = clean(m[2].replace(TRAILING_REFS, ''))
    if (!topic || out.some((l) => l.week === week)) continue
    out.push({ week, topic })
  }
  return out
}

/** Whichever strategy found more weeks. Sorted, deduplicated. */
export function findSchedule(text) {
  const lines = text.split(/\r?\n/)
  const table = parseTable(lines)
  const inline = parseInline(text)
  const best = table.length >= inline.length ? table : inline
  return best.sort((a, b) => a.week - b.week)
}

/** The first date mentioned in a schedule table, for guessing a term start. */
export function firstDateIn(text) {
  const lines = text.split(/\r?\n/)
  const header = lines.findIndex((l) => /\bweeks?\b/i.test(l) && /\btopics?\b/i.test(l))
  if (header === -1) return null
  for (const line of lines.slice(header + 1, header + 6)) {
    const m = new RegExp(`(${MONTH})\\s*(\\d{1,2})`, 'i').exec(line)
    if (m) return { month: m[1].slice(0, 3).toLowerCase(), day: Number(m[2]) }
  }
  return null
}

/* ── the editable file ─────────────────────────────────────────────────── */

const HEADER = `# Lecture topics for this course, one per week of term.
#
# This file wins over anything parsed from a PDF, so correct it freely — later
# scans will not overwrite it. Delete the file to let the parser try again.
#
# Format: week number, a TAB, then the topic.
`

export function readLecturesFile(path) {
  if (!existsSync(path)) return null
  const out = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    // Tab-separated, but tolerate the spaces an editor may have left behind.
    const m = /^\s*(\d{1,2})\s*[\t]+\s*(.+?)\s*$/.exec(line) ?? /^\s*(\d{1,2})\s{2,}(.+?)\s*$/.exec(line)
    if (!m) continue
    const week = Number(m[1])
    if (out.some((l) => l.week === week)) continue
    out.push({ week, topic: m[2].trim() })
  }
  return out.sort((a, b) => a.week - b.week)
}

export function writeLecturesFile(path, lectures, sourceNote) {
  const body = lectures.map((l) => `${l.week}\t${l.topic}`).join('\n')
  writeFileSync(path, `${HEADER}#\n# ${sourceNote}\n\n${body}\n`)
}

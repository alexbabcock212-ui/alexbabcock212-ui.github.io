/**
 * Turn a course's own PDFs into a week-by-week picture of the term.
 *
 * Two sources, doing different jobs:
 *
 *   - the **outline** gives the schedule table — week, dates, topic, chapters;
 *   - each week's **lecture deck** gives what that lecture actually covers,
 *     because decks very often open with a learning-objectives slide.
 *
 * Nothing here writes a summary. Every word it produces was already in one of
 * the user's files. Where a deck has no objectives slide it falls back to the
 * deck's own title line, which is thin but true, rather than inventing prose.
 *
 * Everything lands in an editable `lectures.tsv` that wins field by field, so a
 * bad parse is a one-time correction that never regresses.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

/* ── extraction ────────────────────────────────────────────────────────── */

/**
 * Text from a PDF.
 *
 * `unpdf` rather than a hand-rolled reader: pulling literal strings out of the
 * content streams ignores the font's ToUnicode map, which on a real syllabus
 * turned "PRINCIPLES" into "P R I ! C I P LES".
 */
export async function extractText(path) {
  const { extractText: extract, getDocumentProxy } = await import('unpdf')
  const { readFile } = await import('node:fs/promises')
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)))
  const { text } = await extract(pdf, { mergePages: true })
  return text
}

/* ── the schedule table ────────────────────────────────────────────────── */

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'

/** `Sep 10 and 12`, `Oct 14 to Oct 18`, `Sept. 3` — the whole date column. */
const DATES = new RegExp(
  `^\\s*(${MONTH}\\s*\\d{1,2}` +
    `(?:\\s*(?:and|to|&|-|–|—|,)\\s*(?:${MONTH}\\s*)?\\d{1,2})*)\\s*`,
  'i',
)

/** A trailing chapter/reading column: bare numbers, ranges, dashes. */
const TRAILING_REFS =
  /[\s,;]+((?:ch(?:apter)?s?\.?\s*)?[\d]+(?:\s*[-–—]\s*[\d]+)?(?:\s*,\s*[\d]+(?:\s*[-–—]\s*[\d]+)?)*)\s*$/i

/** A cell that is only punctuation — an em-dash placeholder for "none". */
const EMPTY_ISH = /^[\s—–\-.·|]*$/

const clean = (s) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—\-|]+/, '')
    .replace(/[\s:–—\-|]+$/, '')
    .trim()

/** Split one table row into its columns, whichever of them are present. */
function splitRow(rest) {
  let text = rest

  const dateMatch = DATES.exec(text)
  const dates = dateMatch ? clean(dateMatch[1]) : ''
  if (dateMatch) text = text.slice(dateMatch[0].length)

  const refMatch = TRAILING_REFS.exec(text)
  const readings = refMatch ? clean(refMatch[1]) : ''
  if (refMatch) text = text.slice(0, refMatch.index)

  return { dates, readings, label: clean(text) }
}

/** Where the schedule table starts, or -1. */
const headerIndex = (lines) =>
  lines.findIndex((l) => /\bweeks?\b/i.test(l) && /\btopics?\b/i.test(l) && l.length < 80)

/**
 * Table form: a `week | dates | topic | chapters` header, then numbered rows.
 *
 * Rows without a leading week number are not lectures — they are midterms and
 * reading weeks. `findAssessments` collects those; giving them a week number
 * here would misalign every week after them.
 */
function parseTable(lines) {
  const header = headerIndex(lines)
  if (header === -1) return []

  const out = []
  let misses = 0

  for (const raw of lines.slice(header + 1)) {
    const line = raw.trim()
    if (!line) continue

    const m = /^(\d{1,2})\b\s*(.*)$/.exec(line)
    if (!m) {
      if (++misses > 4) break
      continue
    }

    const week = Number(m[1])
    if (week < 1 || week > 30) {
      if (++misses > 4) break
      continue
    }

    const { dates, readings, label } = splitRow(m[2])
    if (!label || EMPTY_ISH.test(label)) {
      if (++misses > 4) break
      continue
    }

    misses = 0
    // A repeated week number means we have run past the table into prose.
    if (out.some((l) => l.week === week)) break
    out.push({ week, topic: label, dates, readings })
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
    const { readings, label } = splitRow(m[2])
    if (!label || out.some((l) => l.week === week)) continue
    out.push({ week, topic: label, dates: '', readings })
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

/**
 * The dated rows that are not lectures: midterms, finals, reading week.
 *
 * Genuinely useful and previously discarded — a midterm on Oct 06 is the single
 * most load-bearing line in a syllabus.
 */
export function findAssessments(text) {
  const lines = text.split(/\r?\n/)
  const header = headerIndex(lines)
  if (header === -1) return []

  const out = []
  let misses = 0

  for (const raw of lines.slice(header + 1)) {
    const line = raw.trim()
    if (!line) continue
    if (/^\d{1,2}\b/.test(line)) {
      misses = 0
      continue
    }

    const { dates, label } = splitRow(line)
    // Without a date it is prose, not a table row — the table has ended.
    if (!dates || !label || EMPTY_ISH.test(label) || label.length > 60) {
      if (++misses > 4) break
      continue
    }

    misses = 0
    out.push({ label, dates })
  }

  return out
}

/** The first date in the table, for guessing a term start. */
export function firstDateIn(text) {
  const lines = text.split(/\r?\n/)
  const header = headerIndex(lines)
  if (header === -1) return null
  for (const line of lines.slice(header + 1, header + 6)) {
    const m = new RegExp(`(${MONTH})\\s*(\\d{1,2})`, 'i').exec(line)
    if (m) return { month: m[1].slice(0, 3).toLowerCase(), day: Number(m[2]) }
  }
  return null
}

/* ── what a lecture deck says it covers ────────────────────────────────── */

const CUE =
  /(after (?:studying|completing|reading)|learning (?:objectives|outcomes|goals)|you will be able to|^outline\b|^agenda\b|topics? covered|in this (?:chapter|lecture))/i

/** Slide furniture that is not content. */
const NOISE =
  /^(©|copyright|\d+$|slide \d+|pearson|mcgraw|wiley|all rights reserved|www\.|http)/i

const MAX_POINTS = 4
const MAX_DETAIL = 400

const tidyPoint = (l) =>
  clean(l.replace(/^[◆•▪●○\-*–—]+\s*/, '').replace(/^\d+[.)]\s*/, ''))

/**
 * The deck's own heading.
 *
 * A title slide's text usually arrives as several runs, so a heading like
 * "MONITORING THE VALUE OF WHAT WE PRODUCE" extracts as two lines and taking
 * only the first leaves it cut mid-phrase. A short opening line with no
 * terminal punctuation is treated as the start of a wrapped heading.
 */
function titleOf(lines) {
  const candidates = []
  for (const l of lines.slice(0, 6)) {
    // Past the objectives cue there is no more title, only content.
    if (CUE.test(l)) break
    // Strip a leading chapter/unit number: "6 ECONOMIC GROWTH" -> "ECONOMIC GROWTH".
    const t = clean(l.replace(/^\d{1,2}[.):\s]\s*/, ''))
    if (t.length >= 4) candidates.push(t)
    if (candidates.length === 2) break
  }
  if (candidates.length === 0) return ''

  const [first, second] = candidates
  if (!second) return first.slice(0, 90)

  // "Short and unpunctuated" is not enough on its own — it also describes an
  // ordinary heading followed by body text. A wrapped heading looks like one:
  // either it is set in capitals like the line it continues onto, or it breaks
  // on a word that cannot end a title.
  const shouty = (t) => t === t.toUpperCase() && /[A-Z]/.test(t)
  const breaksOpen = /\b(of|and|the|in|on|to|for|a|an|&)$|[,:–—-]$/i.test(first)

  const wrapped =
    first.length < 34 &&
    second.length <= 40 &&
    !/[.!?]$/.test(second) &&
    // A bullet is the start of the content, not the rest of the heading.
    !/^[◆•▪●○\-*–—]|^\d+[.)]\s/.test(second) &&
    (shouty(first) || breaksOpen)

  return (wrapped ? `${first} ${second}` : first).slice(0, 90)
}

/**
 * What a deck says it will cover.
 *
 * Returns the deck's heading and, where it has one, its objectives slide. About
 * a third of real decks carry objectives; the rest give up only a title. Both
 * are the deck's own words — nothing here writes prose.
 */
export function extractObjectives(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.test(l))

  const title = titleOf(lines)
  const cue = lines.findIndex((l) => CUE.test(l))
  if (cue === -1) return { title, objectives: '' }

  const points = []
  let buffer = ''

  for (const line of lines.slice(cue + 1, cue + 20)) {
    if (CUE.test(line)) break
    // Decks wrap one bullet across several text runs; a new bullet marker
    // closes the previous one.
    const starts = /^[◆•▪●○\-*–—]|^\d+[.)]\s/.test(line)
    if (starts && buffer) {
      points.push(tidyPoint(buffer))
      buffer = ''
    }
    buffer = buffer ? `${buffer} ${line}` : line
    if (points.length >= MAX_POINTS) break
  }
  if (buffer && points.length < MAX_POINTS) points.push(tidyPoint(buffer))

  const kept = points.filter((p) => p.length > 8).slice(0, MAX_POINTS)
  return { title, objectives: kept.join(' · ').slice(0, MAX_DETAIL) }
}

/**
 * How likely a file is to be the week's actual lecture deck.
 *
 * Worth scoring rather than pattern-matching: a folder holds the deck next to
 * problem sets and solutions, and "Chapter 05 examples.pdf" matches every naive
 * test for "chapter" while containing exercises rather than objectives.
 */
export function deckScore(name) {
  const n = name.toLowerCase()
  let score = 0
  if (/lecture|slides?|deck|notes/.test(n)) score += 4
  if (/\bunit\b|\bweek\b|\bppt\b/.test(n)) score += 2
  if (/chapter|\bch\d/.test(n)) score += 1
  if (/example|problem|exercise|practice|tutorial|quiz|assignment/.test(n)) score -= 5
  if (/solution|answer|key\b|marking|rubric/.test(n)) score -= 6
  if (/midterm|final|exam|test/.test(n)) score -= 4
  if (/copy|\(\d\)/.test(n)) score -= 1
  return score
}

/* ── the editable file ─────────────────────────────────────────────────── */

const HEADER = `# Lecture topics for this course, one row per week of term.
#
# Tab-separated:  week <TAB> topic <TAB> readings <TAB> detail
#
# Lecture dates are not a column here — they come from the syllabus every scan.
#
# Anything you write here is kept. Empty fields get filled in by later scans
# from the syllabus and that week's slides; fields you have filled in are never
# overwritten. Delete the file entirely to start over from the PDFs.
`

/** Parse the editable file. Tolerates the older two-column form. */
export function readLecturesFile(path) {
  if (!existsSync(path)) return null

  const out = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    // Tabs are the format, but an editor may have replaced them with spaces.
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/)).map((c) =>
      c.trim(),
    )
    const week = Number(cells[0])
    if (!Number.isInteger(week) || week < 1 || week > 30) continue
    if (out.some((l) => l.week === week)) continue

    out.push({
      week,
      topic: cells[1] ?? '',
      readings: cells[2] ?? '',
      detail: cells[3] ?? '',
    })
  }

  return out.sort((a, b) => a.week - b.week)
}

export function writeLecturesFile(path, lectures, sourceNote) {
  const body = lectures
    .map((l) => [l.week, l.topic ?? '', l.readings ?? '', l.detail ?? ''].join('\t'))
    .join('\n')
  writeFileSync(path, `${HEADER}#\n# ${sourceNote}\n\n${body}\n`)
}

/**
 * Combine what the file says with what was parsed.
 *
 * Field by field, not row by row: a hand-written detail must survive a rescan,
 * while an empty one should fill itself in as slides appear. Returns the merged
 * rows and whether anything actually changed, so the file is only rewritten
 * when there is something new to record.
 */
export function mergeLectures(fromFile, parsed) {
  const byWeek = new Map()
  for (const l of parsed) byWeek.set(l.week, { ...l })

  for (const l of fromFile ?? []) {
    const existing = byWeek.get(l.week) ?? { week: l.week, topic: '', readings: '', detail: '' }
    byWeek.set(l.week, {
      week: l.week,
      // The file wins wherever it has something to say.
      topic: l.topic || existing.topic || '',
      readings: l.readings || existing.readings || '',
      detail: l.detail || existing.detail || '',
      // Not a column in the file — the syllabus is the only source of dates,
      // so they always come from the parse rather than being round-tripped.
      dates: existing.dates ?? '',
    })
  }

  const merged = [...byWeek.values()].sort((a, b) => a.week - b.week)

  const before = JSON.stringify(
    (fromFile ?? []).map((l) => [l.week, l.topic, l.readings, l.detail]),
  )
  const after = JSON.stringify(merged.map((l) => [l.week, l.topic, l.readings, l.detail]))

  return { merged, changed: before !== after }
}

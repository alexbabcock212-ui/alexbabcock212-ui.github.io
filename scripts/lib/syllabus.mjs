/**
 * Turn a course's own PDFs into a week-by-week picture of the term.
 *
 * Two sources, doing different jobs:
 *
 *   - the **outline** gives the schedule table — week, dates, topic, chapters;
 *   - each week's **lecture decks** give what those lectures actually cover,
 *     read from the deck's own summary slide where it wrote one and from its
 *     slide headings where it did not.
 *
 * Nothing here writes a summary. Every word it produces was already in one of
 * the user's files. A deck with nothing to say yields an empty list, never a
 * plausible-sounding one.
 *
 * Everything lands in an editable `lectures.tsv` that wins field by field, so a
 * bad parse is a one-time correction that never regresses.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

/* ── extraction ────────────────────────────────────────────────────────── */

/**
 * Text from an outline, whatever it was written in.
 *
 * Syllabi arrive as both PDFs and Word files — this term's History outline is a
 * `.docx` — and a course whose schedule cannot be read shows up on the screen
 * as "no syllabus", which is indistinguishable from not having handed one in.
 */
export async function extractText(path) {
  return /\.docx$/i.test(path) ? extractDocx(path) : extractPdf(path)
}

/**
 * Text from a PDF.
 *
 * `unpdf` rather than a hand-rolled reader: pulling literal strings out of the
 * content streams ignores the font's ToUnicode map, which on a real syllabus
 * turned "PRINCIPLES" into "P R I ! C I P LES".
 */
async function extractPdf(path) {
  const { extractText: extract, getDocumentProxy } = await import('unpdf')
  const { readFile } = await import('node:fs/promises')
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)))
  const { text } = await extract(pdf, { mergePages: true })
  return text
}

/**
 * One member of a zip archive, by exact name.
 *
 * A `.docx` is a zip, and the only part worth reading is `word/document.xml`.
 * Thirty lines of the zip format is cheaper than a dependency for one file,
 * and unlike shelling out to `unzip` it cannot fail on a machine that has no
 * `unzip` on its PATH.
 */
function unzipEntry(buf, want) {
  // The central directory is found from the end-of-central-directory record,
  // which sits at the end of the file behind a comment of unknown length.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd === -1) return null

  let at = buf.readUInt32LE(eocd + 16)
  const count = buf.readUInt16LE(eocd + 10)

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) return null
    const method = buf.readUInt16LE(at + 10)
    const compressed = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const localAt = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)

    if (name === want) {
      // The local header repeats the name and extra fields at its own lengths,
      // which are not always the central directory's — the data starts after
      // whatever *it* declares.
      const lNameLen = buf.readUInt16LE(localAt + 26)
      const lExtraLen = buf.readUInt16LE(localAt + 28)
      const from = localAt + 30 + lNameLen + lExtraLen
      const raw = buf.subarray(from, from + compressed)
      return method === 0 ? raw : inflateRawSync(raw)
    }

    at += 46 + nameLen + extraLen + commentLen
  }
  return null
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/**
 * Text from a Word file.
 *
 * WordprocessingML carries no line breaks of its own — the structure *is* the
 * markup — so the tags that end a block have to become the whitespace a reader
 * would see. Paragraphs and table rows end a line; tabs and table cells
 * separate columns, which is what `splitRow` reads a schedule out of.
 */
function extractDocx(path) {
  const xml = unzipEntry(readFileSync(path), 'word/document.xml')
  if (!xml) return ''

  const text = xml
    .toString('utf8')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e])

  return (
    text
      // A cell's own paragraph break lands just before the cell separator;
      // without this every table row arrives pre-split into single columns.
      .replace(/\n+\t/g, '\t')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * The same document, one string per page.
 *
 * A syllabus is prose and reads fine merged. A deck is not: in a deck the page
 * *is* the unit of meaning — one slide, one heading, one idea — and merging
 * throws away the only structure it has. Everything that reads a deck wants
 * this; everything that reads an outline wants the one above.
 */
export async function extractPages(path) {
  const { extractText: extract, getDocumentProxy } = await import('unpdf')
  const { readFile } = await import('node:fs/promises')
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)))
  const { text } = await extract(pdf, { mergePages: false })
  return Array.isArray(text) ? text : [text]
}

/* ── the schedule table ────────────────────────────────────────────────── */

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'

/**
 * `Sep 10 and 12`, `Oct 14 to Oct 18`, `Sept. 3` — the whole date column.
 *
 * Both orders: a table writes `Sept 10`, but prose routinely writes
 * `10 September`, and reading only the first leaves the date sitting at the
 * front of the topic where it is read as part of the title.
 */
const DATES = new RegExp(
  `^\\s*((?:${MONTH}\\s*\\d{1,2}|\\d{1,2}\\s*${MONTH})` +
    `(?:\\s*(?:and|to|&|-|–|—|,)\\s*(?:${MONTH}\\s*)?\\d{1,2})*)\\s*`,
  'i',
)

/**
 * A trailing chapter/reading column: bare numbers, ranges, dashes.
 *
 * Three digits at most, because a chapter number is never four and a year
 * always is — unbounded, this read the tail of "The Long Path to War, 1896 to
 * 1911" as a reading and published the topic with its date range torn off.
 */
const TRAILING_REFS =
  /[\s,;]+((?:ch(?:apter)?s?\.?\s*)?\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)*)\s*$/i

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

/**
 * Inline form: `Week 3: Consumer choice`, `Week 3 — Consumer choice`.
 *
 * The `#` is optional and so is the space around it: one real syllabus writes
 * `Week #1:` for its first two weeks and `Week#3:` for every week after.
 */
function parseInline(text) {
  const out = []
  const re = /\bweek\s*#?\s*(\d{1,2})\s*[:–—\-.)]\s*([^\n]{3,90})/gi
  let m
  while ((m = re.exec(text)) !== null) {
    const week = Number(m[1])
    const { dates, readings, label } = splitRow(m[2])
    if (!label || out.some((l) => l.week === week)) continue
    // The date was being parsed and then dropped on the floor here. An inline
    // schedule routinely carries one — `Week #1: 10 September: …` — and it is
    // what lines the row up with today.
    out.push({ week, topic: label, dates, readings })
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
  if (header === -1) return fromInline(text)

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

/** Rows that are an assessment rather than a lecture. */
const EXAM = /\b(mid-?terms?|finals?|exams?|tests?|quiz(?:zes)?|essays?|papers?)\b/i

/**
 * The same rows, out of an inline schedule.
 *
 * A table keeps its exams on their own unnumbered rows, which is what the loop
 * above reads. An inline syllabus has no such row — the midterm *is* week 7 —
 * so the only place to find it is the schedule itself. Dateless matches are
 * dropped rather than guessed at: "Final Exam= 60%" says nothing about when.
 */
function fromInline(text) {
  return parseInline(text)
    .filter((l) => l.dates && EXAM.test(l.topic))
    .map((l) => ({ label: l.topic, dates: l.dates }))
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

/* ── the outline of a deck ─────────────────────────────────────────────── */

/**
 * A slide whose *bullets* are the summary — the deck saying what it covers.
 *
 * Ranked, because a deck often has several: "Main Points" is a list of topics
 * and "Main Questions" is a list of questions about them, and given both the
 * first is the better answer to "what will I learn this week".
 */
const SUMMARY_SLIDES = [
  /^(main |key )?(points|topics|themes)\b/i,
  /^(learning )?(objectives|outcomes|goals)\b/i,
  /^(outline|agenda|overview|road ?map)\b/i,
  /^(main |key )?questions\b/i,
  /^(what we|topics) (will )?cover/i,
]

/** Slide headings that are furniture rather than subject matter. */
const FURNITURE =
  /^(questions\??|any questions\??|thank you|thanks|references?|bibliography|works cited|sources|next (class|time|week|lecture)|announcements?|reminders?|recap|review|summary|conclusion|the end|discussion|break|image|map from|figure \d)/i

/** How many headings a week's panel can carry before it stops being a summary. */
const MAX_TOPICS = 12

const linesOf = (page) =>
  page
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.test(l))

/** `• foo` / `1) foo` — a bullet marker, meaning a new point starts here. */
const STARTS_POINT = /^[◆•▪●○➔➢‣·\-*–—]|^\d+[.)]\s/

/**
 * The points under a heading.
 *
 * Decks wrap one bullet across several text runs, so a run only closes the
 * previous point when it opens with a marker of its own. Without this a single
 * bullet arrives as four fragments, each cut mid-clause.
 */
function pointsFrom(lines, limit) {
  const points = []
  let buffer = ''

  for (const line of lines) {
    if (STARTS_POINT.test(line) && buffer) {
      points.push(tidyPoint(buffer))
      buffer = ''
      if (points.length >= limit) break
    }
    buffer = buffer ? `${buffer} ${line}` : line
  }
  if (buffer && points.length < limit) points.push(tidyPoint(buffer))

  return points.filter((p) => p.length > 8 && p.length < 200).slice(0, limit)
}

/**
 * `Lecture 3: Historical Background II: Greece 404-359 BC` on a title slide.
 *
 * Deliberately not `week`. A deck headed "Week 1 – The Enlightenment" is
 * telling you which *week* it belongs to, and a week folder routinely holds
 * two lectures — reading that 1 as a lecture number is how two decks end up
 * claiming to be the same lecture.
 */
const LECTURE_LINE = /^(?:lecture|lesson|class|session)\s*(\d{1,2})\s*[:.\-–—]\s*(.*)$/i

/** A parenthetical, a date, a name — the rest of a title slide's furniture. */
const TITLE_FURNITURE = /^[([]|^(dr|prof|professor|mr|ms|mrs)\b|^\d{4}$/i

/**
 * What one deck calls itself, and which lecture it is.
 *
 * Every deck in a course tends to carry the *course* name on its title slide,
 * which is worthless as a lecture heading — but underneath it there is usually
 * a "Lecture 3: …" line, which is both the real heading and the deck's place in
 * the term. That line wraps, and the wrap is the rest of the title slide, so
 * the continuation is taken rather than the heading left cut mid-phrase.
 */
export function deckHeading(pages) {
  const lines = linesOf(pages[0] ?? '')

  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const m = LECTURE_LINE.exec(lines[i])
    if (!m) continue

    const parts = [m[2]]
    for (const next of lines.slice(i + 1, i + 3)) {
      if (TITLE_FURNITURE.test(next) || LECTURE_LINE.test(next)) break
      parts.push(next)
    }
    return { number: Number(m[1]), title: clean(parts.join(' ')) }
  }

  return { number: null, title: titleOf(lines) }
}

/**
 * What a lecture deck covers, in the deck's own words.
 *
 * Two readings, best first.
 *
 * A deck that opens with a "Main Points" or "Learning Objectives" slide has
 * already answered the question, in the lecturer's own summary, and that is
 * used verbatim.
 *
 * Failing that, the *headings* are the answer. One slide is one idea, so the
 * first line of each slide is a section title and the sequence of them is the
 * lecture's table of contents. That is why this reads pages rather than the
 * merged text: merging is what destroys the one structure a deck has.
 *
 * Nothing is written here either way. Consecutive repeats collapse (a section
 * running over four slides is one topic, not four), furniture is dropped, and
 * what is left is the deck's own order.
 */
export function outlineDeck(pages) {
  const slides = pages.length
  const { number, title } = deckHeading(pages)

  const heads = []
  for (let i = 0; i < pages.length; i++) {
    const lines = linesOf(pages[i])
    if (lines.length === 0) continue
    heads.push({ page: i, head: lines[0], rest: lines.slice(1) })
  }

  // 1. The deck's own summary slide, if it wrote one.
  for (const pattern of SUMMARY_SLIDES) {
    const slide = heads.find((h) => pattern.test(h.head))
    if (!slide) continue
    const points = pointsFrom(slide.rest, MAX_TOPICS)
    if (points.length >= 2) {
      return { number, title, slides, topics: points, source: 'summary' }
    }
  }

  // 2. Otherwise the section headings, in order.
  const topics = []
  const seen = new Set()
  for (const { page, head } of heads) {
    // The title slide is the deck's name, not one of its sections.
    if (page === 0) continue
    if (STARTS_POINT.test(head)) continue
    if (FURNITURE.test(head)) continue
    if (head.length < 4 || head.length > 90) continue

    const key = head.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    topics.push(clean(head))
    if (topics.length >= MAX_TOPICS) break
  }

  return { number, title, slides, topics, source: 'sections' }
}

/* ── the editable file ─────────────────────────────────────────────────── */

const HEADER = `# Lecture topics for this course, one row per week of term.
#
# Tab-separated:  week <TAB> topic <TAB> readings <TAB> detail
#
# Lecture dates are not a column here — they come from the syllabus every scan.
#
# 'detail' is yours. Nothing is ever parsed into it: what each lecture covers
# is read straight from that week's slides every scan and shown under the week,
# so this column is for the note you want above all that, or for a week whose
# deck you do not have. It shows on the screen labelled as your note.
#
# Anything you write here is kept. Empty fields get filled in by later scans
# from the syllabus; fields you have filled in are never overwritten. Delete
# the file entirely to start over from the PDFs.
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

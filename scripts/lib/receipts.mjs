/**
 * Reading receipts, and the file they are kept in.
 *
 * Two jobs that both have to happen on the Mac: making sense of what the reader
 * says about a photo, and keeping the result somewhere a person can correct it.
 * That store is `~/Desktop/Receipts/receipts.tsv` — a flat, tab-separated file
 * for the same reason `lectures.tsv` is one. A misread line is a five-second fix
 * in any text editor, on a file you can read without this tool, and it survives
 * every later scan.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** The buckets a line can fall in. Anything else becomes `other`. */
export const CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'bakery',
  'frozen',
  'pantry',
  'beverages',
  'snacks',
  'household',
  'personal',
  'other',
]

/**
 * Lines a receipt prints that are not things you bought.
 *
 * The reader is told to skip these, and mostly does. This is the backstop: a
 * subtotal counted as groceries would inflate every week it touched by half
 * again, and it would look entirely plausible on the screen.
 */
const NOT_AN_ITEM =
  /^(sub-?total|total|balance|tax|hst|gst|pst|vat|change|cash|debit|credit|visa|mastercard|interac|tender|deposit|bottle deposit|savings?|discount|loyalty|points|rounding|tip|amount due|payment)\b/i

const HEADER = `# Every line of every receipt that has been read, one row per line item.
#
# Tab-separated:
#   receipt <TAB> date <TAB> store <TAB> status <TAB> photo <TAB> item
#           <TAB> category <TAB> qty <TAB> price <TAB> lifespan <TAB> total
#
# This file is yours to correct. A misread name, a wrong price, a category that
# went to the wrong bucket — fix it here and the number on the screen follows at
# the next scan. Nothing overwrites a row that already exists.
#
# status  'pending' until you have checked the receipt, then 'kept'. Nothing
#         pending counts toward a week. Marking any one row of a receipt 'kept'
#         keeps the whole receipt.
#
# lifespan  How many weeks that purchase lasts, as the reader guessed it. This
#         is the weakest of the four answers the app uses: your own number wins,
#         then the pace you actually rebuy at once there are three purchases to
#         measure, then this, then the category default. Set it here and it
#         becomes the reader's guess, not yours — to override it for good, set
#         the lifespan on the FOOD screen instead.
#
# The receipt-level columns (date, store, photo, total) are read from the first
# row of each receipt. Delete a row to drop a line that was never bought.
#
`

/* ── what the reader said ──────────────────────────────────────────────── */

/**
 * The JSON out of a model's answer.
 *
 * It is asked for bare JSON and usually obliges, but not always — a fenced
 * block is the common one, and a sentence in front of it happens. Rather than
 * fail on a good reading because of its packaging, take the first balanced
 * object in the text.
 */
export function parseReaderOutput(text) {
  if (typeof text !== 'string') return null

  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const c = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }

    if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }

  return null
}

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[^0-9.-]/g, '')) : Number(v)
  return Number.isFinite(n) ? n : null
}

const clean = (v) =>
  String(v ?? '')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** `2026-09-02`, or null. Anything else is not a date this file will keep. */
export function cleanDate(v) {
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v ?? ''))
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * A reading turned into a receipt, or null if there is nothing usable in it.
 *
 * Every field is either something the reader actually said or an admitted
 * absence. Nothing is invented to fill a hole: a line with no price is dropped
 * rather than priced at zero, because a zero would silently make the week look
 * cheaper than it was.
 */
export function toReceipt(raw, { id, photo, fallbackDate }) {
  if (!raw || typeof raw !== 'object') return null

  const date = cleanDate(raw.date) ?? cleanDate(fallbackDate)
  if (!date) return null

  const lines = []
  for (const line of Array.isArray(raw.lines) ? raw.lines : []) {
    const item = clean(line?.item)
    const price = num(line?.price)
    if (!item || price === null || price <= 0) continue
    if (NOT_AN_ITEM.test(item)) continue

    const category = CATEGORIES.includes(String(line?.category).toLowerCase())
      ? String(line.category).toLowerCase()
      : 'other'

    const qty = Math.max(1, Math.round(num(line?.qty) ?? 1))
    const estimate = num(line?.lifespanWeeks)

    lines.push({
      id: `${id}-${lines.length + 1}`,
      item,
      category,
      qty,
      price: Math.round(price * 100) / 100,
      estimate: estimate !== null && estimate > 0 ? Math.round(estimate * 100) / 100 : null,
    })
  }

  if (lines.length === 0) return null

  return {
    id,
    store: clean(raw.store) || 'Unknown',
    date,
    total: num(raw.total),
    photo: clean(photo),
    status: 'pending',
    lines,
  }
}

/**
 * An id for a receipt that reads as itself in the file.
 *
 * `2026-09-02-metro`, and `-2` after it when that shop was visited twice in a
 * day. Derived rather than random so that re-reading the same photo produces
 * the same rows instead of a duplicate week's worth of food.
 */
export function receiptId(date, store, taken) {
  const slug =
    clean(store)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'shop'

  const base = `${date}-${slug}`
  if (!taken.has(base)) return base

  for (let n = 2; n < 100; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
  return `${base}-${Date.now()}`
}

/* ── the file ──────────────────────────────────────────────────────────── */

const COLUMNS = [
  'receipt',
  'date',
  'store',
  'status',
  'photo',
  'item',
  'category',
  'qty',
  'price',
  'lifespan',
  'total',
]

/**
 * The file's text turned back into receipts.
 *
 * Kept apart from reading the file so that the format — which is the part with
 * decisions in it — can be checked without a filesystem.
 */
export function parseReceipts(text) {
  const byId = new Map()

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue

    // Tabs are the format, but a spreadsheet round-trip or a careless paste can
    // leave runs of spaces instead.
    const cells = (raw.includes('\t') ? raw.split('\t') : raw.split(/\s{2,}/)).map((c) => c.trim())
    if (cells[0] === COLUMNS[0]) continue

    const [id, date, store, status, photo, item, category, qty, price, lifespan, total] = cells
    const when = cleanDate(date)
    const paid = num(price)
    if (!id || !when || !item || paid === null) continue

    let receipt = byId.get(id)
    if (!receipt) {
      receipt = {
        id,
        store: store || 'Unknown',
        date: when,
        total: num(total),
        photo: photo ?? '',
        status: 'pending',
        lines: [],
      }
      byId.set(id, receipt)
    }

    // Any row saying `kept` keeps the receipt: checking one line of a shop and
    // leaving the rest is not a thing anyone means to do.
    if (String(status).toLowerCase() === 'kept') receipt.status = 'kept'

    const weeks = num(lifespan)
    receipt.lines.push({
      id: `${id}-${receipt.lines.length + 1}`,
      item,
      category: CATEGORIES.includes(String(category).toLowerCase())
        ? String(category).toLowerCase()
        : 'other',
      qty: Math.max(1, Math.round(num(qty) ?? 1)),
      price: Math.round(paid * 100) / 100,
      estimate: weeks !== null && weeks > 0 ? weeks : null,
    })
  }

  return [...byId.values()]
    .filter((r) => r.lines.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

export function readReceiptsFile(path) {
  return existsSync(path) ? parseReceipts(readFileSync(path, 'utf8')) : []
}

const cell = (v) => clean(v)

/** The receipts as the file's text. See `parseReceipts` for why this is split. */
export function formatReceipts(receipts) {
  const rows = []
  for (const r of receipts) {
    for (const l of r.lines) {
      rows.push(
        [
          r.id,
          r.date,
          cell(r.store),
          r.status === 'kept' ? 'kept' : 'pending',
          cell(r.photo),
          cell(l.item),
          l.category,
          l.qty,
          l.price.toFixed(2),
          l.estimate === null ? '' : String(l.estimate),
          r.total === null || r.total === undefined ? '' : Number(r.total).toFixed(2),
        ].join('\t'),
      )
    }
  }

  return `${HEADER}\n${COLUMNS.join('\t')}\n${rows.join('\n')}\n`
}

export function writeReceiptsFile(path, receipts) {
  writeFileSync(path, formatReceipts(receipts))
}

/**
 * Add what was just read to what was already there.
 *
 * A photo is only ever read once: if its filename is already in the file, the
 * reading is dropped on the floor rather than added again. Re-filing a photo
 * you had already filed is the likeliest way to double a week's groceries, and
 * it would look completely ordinary on the screen.
 */
export function mergeReceipts(existing, incoming) {
  const photos = new Set(existing.map((r) => r.photo).filter(Boolean))
  const ids = new Set(existing.map((r) => r.id))

  const added = []
  for (const r of incoming) {
    if (r.photo && photos.has(r.photo)) continue
    if (ids.has(r.id)) continue
    photos.add(r.photo)
    ids.add(r.id)
    added.push(r)
  }

  const all = [...existing, ...added].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  )
  return { receipts: all, added }
}

/**
 * What a week of food actually costs.
 *
 * The headline figure on the FOOD screen is not what was spent. It is what the
 * week *costs*, with every purchase spread across however long it lasts: a
 * twelve-pack of toilet paper is not an eighteen-dollar week, it is $1.58 a week
 * for twelve weeks. Cash out is shown too, but underneath, because a $190
 * stock-up trip and a $40 milk run say nothing on their own — one of them is
 * three normal weeks and the other is half of one.
 *
 * Everything here is pure. It takes the receipts as they were read and the
 * corrections made since, and derives the rest. That is deliberate: correcting
 * how long something lasts has to rewrite its whole history, and it only can if
 * no derived figure was ever stored.
 */
import type {
  Direction,
  Groceries,
  GroceryCategory,
  GroceryItem,
  GroceryWeek,
  LifespanSource,
  PantryLine,
  PriceMove,
  Receipt,
  ReceiptLine,
  Restock,
} from './types'

/** Dollars a week, the figure the trend is read against. */
export const DEFAULT_TARGET = 150

/** How many weeks the trend shows. */
export const TREND_WEEKS = 12

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * How long a category's purchase lasts when nothing better is known.
 *
 * The last resort, and the screen says so — a figure resting on one of these is
 * a guess about *you* made from a word on a receipt. The point of showing where
 * a lifespan came from is to make these the ones you correct first.
 */
export const CATEGORY_WEEKS: Record<GroceryCategory, number> = {
  produce: 1,
  dairy: 1,
  bakery: 1,
  meat: 2,
  frozen: 4,
  beverages: 2,
  snacks: 2,
  pantry: 6,
  household: 10,
  personal: 10,
  other: 3,
}

/**
 * How many separate shops it takes before your own pace outranks a guess.
 *
 * Three, because two purchases are one interval and one interval is an anecdote
 * — a single holiday or a single stock-up would set the figure for good.
 */
export const MIN_BUYS_FOR_PACE = 3

/** Below this a price move is noise: a sale, a different size, a rounding. */
export const PRICE_MOVE_PCT = 8

/** Corrections, kept apart from what was read so the two stay distinguishable. */
export interface LineEdit {
  item?: string
  category?: GroceryCategory
  qty?: number
  price?: number
}

export interface PantryEdits {
  /** Weeks you set yourself, by item key. Beats every other answer. */
  lifespan: Record<string, number>
  /** What a line should have said, by line id. */
  lines: Record<string, LineEdit>
  /** Lines struck out — read off the photo, never actually bought. */
  dropped: Record<string, true>
  /** Receipts you have checked. Until then nothing on them counts. */
  reviewed: Record<string, true>
}

export const NO_EDITS: PantryEdits = { lifespan: {}, lines: {}, dropped: {}, reviewed: {} }

/* ── small arithmetic ──────────────────────────────────────────────────── */

const money = (n: number) => Math.round(n * 100) / 100

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Local midnight of a `YYYY-MM-DD`. NaN when it is not one. */
export function dateAt(date: string): number {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date.trim())
  if (!m) return Number.NaN
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return at.getMonth() === Number(m[2]) - 1 ? at.getTime() : Number.NaN
}

/**
 * The Monday of the week a moment falls in, at local midnight.
 *
 * Monday rather than Sunday because a shop on Sunday evening is the start of
 * the week it feeds, not the end of the one before it.
 */
export function weekStart(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** `SEP 1` — the label under a bar. */
export function weekLabel(start: number): string {
  const d = new Date(start)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/**
 * The same thing bought twice, spelled two ways.
 *
 * Sizes and counts come out because they are what changes between shops —
 * `MILK 2% 4L` and `Milk 2L` are the same line of the budget — while the words
 * that make it that item stay. Everything downstream that says "you buy this
 * every nine days" is only as good as this.
 */
export function itemKey(item: string): string {
  return item
    .toLowerCase()
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|lb|oz|l|ml|ct|pk|pack|packs|rolls?|sheets?|x)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How a purchase's cost lands across the weeks it covers, starting the week it
 * was bought.
 *
 * A lifespan of 12 weeks pays out twelve equal shares; 1.5 weeks pays two thirds
 * this week and a third next. Anything under a week lands whole, because a
 * purchase cannot cost you less than itself in the only week it exists in.
 */
export function spread(price: number, weeks: number): number[] {
  const w = Math.max(weeks, Number.EPSILON)
  const n = Math.max(1, Math.ceil(w - 1e-9))
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((price * (Math.min(i + 1, w) - i)) / w)
  return out
}

/* ── lifespan ──────────────────────────────────────────────────────────── */

/**
 * How often you actually rebuy each thing, in weeks.
 *
 * The median gap rather than the mean: one four-month gap over a summer away
 * would otherwise claim a jar of coffee lasts a season. Only keys bought at
 * least `MIN_BUYS_FOR_PACE` times appear — below that there is no pace, only a
 * coincidence.
 */
export function paceByKey(lines: { key: string; at: number }[]): Map<string, number> {
  const dates = new Map<string, Set<number>>()
  for (const l of lines) {
    const set = dates.get(l.key)
    if (set) set.add(l.at)
    else dates.set(l.key, new Set([l.at]))
  }

  const out = new Map<string, number>()
  for (const [key, set] of dates) {
    // Two trips to the same shop in one day are one restock, not two.
    if (set.size < MIN_BUYS_FOR_PACE) continue
    const sorted = [...set].sort((a, b) => a - b)
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i] - sorted[i - 1]) / WEEK_MS)
    const weeks = median(gaps)
    if (weeks > 0) out.set(key, Math.min(Math.max(weeks, 0.5), 52))
  }
  return out
}

/**
 * How long one purchase lasts, and who says so.
 *
 * In order: the number you set, then the pace you actually rebuy at, then the
 * reader's estimate off the receipt, then the category's default. Each layer is
 * better evidence about *you* than the one below it.
 */
export function lifespanOf(
  key: string,
  line: Pick<ReceiptLine, 'category' | 'estimate'>,
  edits: PantryEdits,
  pace: Map<string, number>,
): { weeks: number; source: LifespanSource } {
  const own = edits.lifespan[key]
  if (typeof own === 'number' && own > 0) return { weeks: own, source: 'you' }

  const paced = pace.get(key)
  if (paced !== undefined) return { weeks: paced, source: 'pace' }

  if (line.estimate !== null && line.estimate > 0) {
    return { weeks: line.estimate, source: 'receipt' }
  }

  return { weeks: CATEGORY_WEEKS[line.category] ?? CATEGORY_WEEKS.other, source: 'category' }
}

/* ── assembling the screen ─────────────────────────────────────────────── */

/** True once a receipt has been checked, on this device or in the file. */
export const isKept = (receipt: Receipt, edits: PantryEdits): boolean =>
  receipt.status === 'kept' || edits.reviewed[receipt.id] === true

/** A receipt's lines with your corrections applied and your strike-outs gone. */
export function correct(receipt: Receipt, edits: PantryEdits): ReceiptLine[] {
  return receipt.lines
    .filter((l) => !edits.dropped[l.id])
    .map((l) => {
      const e = edits.lines[l.id]
      if (!e) return l
      return {
        ...l,
        item: e.item ?? l.item,
        category: e.category ?? l.category,
        qty: e.qty ?? l.qty,
        price: e.price ?? l.price,
      }
    })
}

/** What a receipt comes to once corrected — what it is holding out of a week. */
export const receiptTotal = (receipt: Receipt, edits: PantryEdits): number =>
  money(correct(receipt, edits).reduce((sum, l) => sum + l.price, 0))

/**
 * Everything the FOOD screen reads, derived from the receipts and nothing else.
 *
 * Pending receipts are deliberately left out of every figure. They are money
 * that was certainly spent, but on lines nobody has checked yet, and a headline
 * that quietly includes an unread photo is a headline you cannot correct — you
 * would have no way of knowing it was wrong. They are counted and shown as
 * waiting instead.
 */
export function toGroceries(
  receipts: Receipt[],
  edits: PantryEdits,
  now: number,
  target = DEFAULT_TARGET,
  scannedAt: number | null = null,
): Groceries {
  const kept: Receipt[] = []
  const pending: Receipt[] = []
  for (const r of receipts) (isKept(r, edits) ? kept : pending).push(r)

  /* Every checked line, dated and keyed, before any lifespan is decided. */
  const base = kept.flatMap((receipt) => {
    const at = dateAt(receipt.date)
    if (Number.isNaN(at)) return []
    return correct(receipt, edits).map((line) => ({
      line,
      receipt,
      at,
      key: itemKey(line.item) || itemKey(line.category),
    }))
  })

  // Pace has to be known before any single line's lifespan is, since it is a
  // fact about the key rather than about the purchase.
  const pace = paceByKey(base)

  const lines: PantryLine[] = base.map(({ line, receipt, at, key }) => {
    const { weeks, source } = lifespanOf(key, line, edits, pace)
    return {
      id: line.id,
      receipt: receipt.id,
      store: receipt.store,
      date: receipt.date,
      at,
      item: line.item,
      key,
      category: line.category,
      qty: line.qty,
      price: line.price,
      weeks,
      weeksSource: source,
      perWeek: money(line.price / Math.max(weeks, Number.EPSILON)),
    }
  })
  lines.sort((a, b) => b.at - a.at || a.item.localeCompare(b.item))

  /* ── the twelve weeks ── */

  const thisWeek = weekStart(now)
  const first = thisWeek - (TREND_WEEKS - 1) * WEEK_MS

  const spreadByWeek = new Map<number, number>()
  const cashByWeek = new Map<number, number>()
  for (const l of lines) {
    const start = weekStart(l.at)
    cashByWeek.set(start, (cashByWeek.get(start) ?? 0) + l.price)
    const shares = spread(l.price, l.weeks)
    for (let i = 0; i < shares.length; i++) {
      const w = start + i * WEEK_MS
      // A purchase covers weeks after today too; the trend stops at today, so
      // those shares are simply not drawn rather than piled onto the last bar.
      if (w > thisWeek) break
      spreadByWeek.set(w, (spreadByWeek.get(w) ?? 0) + shares[i])
    }
  }

  const weeks: GroceryWeek[] = []
  for (let i = 0; i < TREND_WEEKS; i++) {
    const start = first + i * WEEK_MS
    weeks.push({
      start,
      label: weekLabel(start),
      spread: money(spreadByWeek.get(start) ?? 0),
      cash: money(cashByWeek.get(start) ?? 0),
      current: start === thisWeek,
    })
  }

  const perWeek = money(spreadByWeek.get(thisWeek) ?? 0)
  const cash = money(cashByWeek.get(thisWeek) ?? 0)
  const spent = weeks.filter((w) => w.spread > 0).map((w) => w.spread)
  const typical = money(median(spent))

  /* ── what each thing costs to keep ── */

  const byKey = new Map<string, PantryLine[]>()
  for (const l of lines) {
    const list = byKey.get(l.key)
    if (list) list.push(l)
    else byKey.set(l.key, [l])
  }

  const items: GroceryItem[] = []
  for (const [key, ls] of byKey) {
    // `lines` is newest first, so the first of each key is the current spelling,
    // the current price and the current lifespan.
    const latest = ls[0]
    const buys = new Set(ls.map((l) => l.at)).size
    items.push({
      key,
      item: latest.item,
      category: latest.category,
      perWeek: latest.perWeek,
      weeks: latest.weeks,
      weeksSource: latest.weeksSource,
      buys,
      lastAt: latest.at,
      lastPrice: latest.price,
      share: 0,
    })
  }

  const totalPerWeek = items.reduce((sum, i) => sum + i.perWeek, 0)
  for (const i of items) i.share = totalPerWeek > 0 ? i.perWeek / totalPerWeek : 0
  items.sort((a, b) => b.perWeek - a.perWeek || a.item.localeCompare(b.item))

  /* ── what runs out next ── */

  const restock: Restock[] = items
    .map((i) => {
      const dueAt = i.lastAt + i.weeks * WEEK_MS
      return {
        key: i.key,
        item: i.item,
        category: i.category,
        dueAt,
        days: Math.round((dueAt - now) / 86_400_000),
        lastPrice: i.lastPrice,
        weeks: i.weeks,
        weeksSource: i.weeksSource,
      }
    })
    // Something that ran out a month ago was a one-off, not a shortage.
    .filter((r) => r.days <= 7 && r.days >= -21)
    .sort((a, b) => a.days - b.days || a.item.localeCompare(b.item))

  /* ── what changed price ── */

  const moves: PriceMove[] = []
  for (const [key, ls] of byKey) {
    if (ls.length < 2) continue
    const [latest, previous] = ls
    if (latest.at === previous.at) continue
    // Only recent moves: last spring's price is not news, and the item may not
    // even be a regular any more.
    if (latest.at < now - TREND_WEEKS * WEEK_MS) continue

    const nowUnit = latest.price / Math.max(latest.qty, 1)
    const beforeUnit = previous.price / Math.max(previous.qty, 1)
    if (beforeUnit <= 0) continue

    const percent = ((nowUnit - beforeUnit) / beforeUnit) * 100
    if (Math.abs(percent) < PRICE_MOVE_PCT) continue

    const direction: Direction = percent > 0 ? 'up' : 'down'
    moves.push({
      key,
      item: latest.item,
      now: money(nowUnit),
      before: money(beforeUnit),
      percent: Math.round(percent * 10) / 10,
      direction,
      at: latest.at,
    })
  }
  moves.sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent) || a.item.localeCompare(b.item))

  pending.sort((a, b) => (dateAt(b.date) || 0) - (dateAt(a.date) || 0))

  return {
    lines,
    pending,
    pendingTotal: money(pending.reduce((sum, r) => sum + receiptTotal(r, edits), 0)),
    perWeek,
    cash,
    weeks,
    target,
    typical,
    items,
    restock,
    moves,
    scannedAt,
  }
}

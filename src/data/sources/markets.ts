/**
 * Quotes and headlines → the MARKETS screen.
 *
 * Pure functions over what the Worker already fetched. Every number on the
 * screen is arithmetic on a last price and a previous close; the brief at the
 * top is assembled from those same rows and nothing else. Nothing here reads a
 * market, forecasts one, or offers a view on what to do about it — this is a
 * board, in the sense a departures board is a board.
 */
import type { RawHeadline, RawQuote } from '../payload'
import type { Headline, Markets, Quote, QuoteGroup } from '../types'

/* ── the board ─────────────────────────────────────────────────────────── */

interface Spec {
  /** Mirrors a symbol in `SYMBOLS` in `worker/src/markets.ts`. */
  symbol: string
  label: string
  sub: string
  /** How many decimals the level is quoted to. */
  decimals: number
  /**
   * How a move reads.
   *
   * `percent` for anything with a price. `bp` for a yield, where the level is
   * already a percentage and "the 10-year rose 0.17%" is a sentence that means
   * nothing — basis points is how that move is actually spoken.
   */
  change: 'percent' | 'bp'
  /** Appended to the level, for the rows that are quoted in a unit. */
  unit?: string
}

interface Band {
  title: string
  specs: Spec[]
}

/**
 * Mostly North America, with three overseas indexes for overnight context.
 *
 * Ordered the way the screen is read rather than the way the payload arrives:
 * equities first, then what they are being priced against, then the two
 * commodities and the one crypto that make the evening news, then the sessions
 * that closed while this phone was asleep.
 */
const BOARD: Band[] = [
  {
    title: 'NORTH AMERICA',
    specs: [
      { symbol: '^GSPC', label: 'S&P 500', sub: 'New York', decimals: 2, change: 'percent' },
      { symbol: '^IXIC', label: 'Nasdaq', sub: 'Composite', decimals: 2, change: 'percent' },
      { symbol: '^DJI', label: 'Dow Jones', sub: 'Industrials', decimals: 2, change: 'percent' },
      { symbol: '^RUT', label: 'Russell 2000', sub: 'Small caps', decimals: 2, change: 'percent' },
      { symbol: '^GSPTSE', label: 'S&P/TSX', sub: 'Toronto', decimals: 2, change: 'percent' },
    ],
  },
  {
    title: 'RATES, RISK & THE DOLLAR',
    specs: [
      {
        symbol: '^TNX',
        label: 'US 10-year',
        sub: 'Treasury yield',
        decimals: 2,
        change: 'bp',
        unit: '%',
      },
      { symbol: '^VIX', label: 'VIX', sub: 'Implied volatility', decimals: 2, change: 'percent' },
      { symbol: 'CAD=X', label: 'USD/CAD', sub: 'Loonie', decimals: 4, change: 'percent' },
    ],
  },
  {
    title: 'COMMODITIES & CRYPTO',
    specs: [
      { symbol: 'CL=F', label: 'WTI crude', sub: 'Front month', decimals: 2, change: 'percent' },
      { symbol: 'GC=F', label: 'Gold', sub: 'Front month', decimals: 2, change: 'percent' },
      { symbol: 'BTC-USD', label: 'Bitcoin', sub: 'Trades all night', decimals: 0, change: 'percent' },
    ],
  },
  {
    title: 'OVERSEAS',
    specs: [
      { symbol: '^FTSE', label: 'FTSE 100', sub: 'London', decimals: 2, change: 'percent' },
      { symbol: '^STOXX50E', label: 'Euro Stoxx 50', sub: 'Europe', decimals: 2, change: 'percent' },
      { symbol: '^N225', label: 'Nikkei 225', sub: 'Tokyo', decimals: 2, change: 'percent' },
    ],
  },
]

/** The row the screen leads with, when it is on the board. */
const LEAD_SYMBOL = '^GSPC'

/* ── formatting ────────────────────────────────────────────────────────── */

const fixed = (value: number, decimals: number) =>
  value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const signed = (value: number, decimals: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${fixed(Math.abs(value), decimals)}`

/** e.g. `4:00 PM`. Matches the clock in the status bar. */
function timeLabel(at: number): string {
  if (!at) return ''
  return new Date(at)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/[  ]/g, ' ')
}

/**
 * The session's path, flattened onto 0–1.
 *
 * A flat line is drawn down the middle rather than divided by zero, and a
 * couple of points is not a shape worth drawing at all.
 */
export function normalise(values: number[]): number[] {
  if (values.length < 4) return []
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (high === low) return values.map(() => 0.5)
  return values.map((v) => (v - low) / (high - low))
}

/* ── shaping ───────────────────────────────────────────────────────────── */

function toQuote(spec: Spec, raw: RawQuote): Quote {
  const move = raw.price - raw.previousClose
  const percent = (move / raw.previousClose) * 100

  return {
    symbol: spec.symbol,
    label: spec.label,
    sub: spec.sub,
    value: `${fixed(raw.price, spec.decimals)}${spec.unit ?? ''}`,
    change:
      spec.change === 'bp'
        ? `${signed(move * 100, move === 0 ? 0 : 1)} bp`
        : signed(move, spec.decimals),
    percent: spec.change === 'bp' ? '' : `${signed(percent, 2)}%`,
    direction: move > 0 ? 'up' : move < 0 ? 'down' : 'flat',
    spark: normalise(raw.spark),
    time: timeLabel(raw.at),
  }
}

/** `4 UP · 1 DOWN` — the breadth of a band, counted from its own rows. */
function breadth(quotes: Quote[]): string {
  const up = quotes.filter((q) => q.direction === 'up').length
  const down = quotes.filter((q) => q.direction === 'down').length
  return [up > 0 && `${up} UP`, down > 0 && `${down} DOWN`].filter(Boolean).join(' · ')
}

export function toGroups(raws: RawQuote[]): QuoteGroup[] {
  const bySymbol = new Map(raws.map((r) => [r.symbol, r]))

  return BOARD.map((band): QuoteGroup => {
    const quotes = band.specs.flatMap((spec) => {
      const raw = bySymbol.get(spec.symbol)
      return raw ? [toQuote(spec, raw)] : []
    })
    return { title: band.title, meta: breadth(quotes), quotes }
  }).filter((group) => group.quotes.length > 0)
}

/* ── the brief ─────────────────────────────────────────────────────────── */

const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six']

const count = (n: number) => COUNT[n] ?? String(n)

/**
 * Two sentences on where things stand, assembled from the rows above.
 *
 * Every clause is a count or a number already on the screen. There is no
 * adjective here that the arithmetic does not license, and deliberately no
 * causal claim: this screen can see that the Nasdaq rose, never why.
 */
export function toBrief(groups: QuoteGroup[]): string | null {
  const all = groups.flatMap((g) => g.quotes)
  const find = (symbol: string) => all.find((q) => q.symbol === symbol) ?? null
  if (all.length === 0) return null

  const north = groups.find((g) => g.title === 'NORTH AMERICA')?.quotes ?? []
  const sentences: string[] = []

  if (north.length > 0) {
    const up = north.filter((q) => q.direction === 'up').length
    const down = north.filter((q) => q.direction === 'down').length
    const led =
      up === north.length
        ? `All ${count(north.length).toLowerCase()} North American indexes higher`
        : down === north.length
          ? `All ${count(north.length).toLowerCase()} North American indexes lower`
          : `${count(up)} of ${count(north.length).toLowerCase()} North American indexes higher`

    const named = [find('^GSPC'), find('^GSPTSE')]
      .filter((q): q is Quote => q !== null)
      .map((q) => `${q.label} ${q.percent}`)

    sentences.push(named.length > 0 ? `${led} — ${named.join(', ')}.` : `${led}.`)
  }

  const context = [
    find('^TNX') && `the 10-year at ${find('^TNX')!.value}`,
    find('CAD=X') && `the loonie at ${find('CAD=X')!.value}`,
    find('CL=F') && `crude at ${find('CL=F')!.value}`,
  ].filter((part): part is string => Boolean(part))

  if (context.length > 0) {
    const last = context.pop()!
    sentences.push(
      context.length > 0 ? `With ${context.join(', ')} and ${last}.` : `With ${last}.`,
    )
  }

  return sentences.length > 0 ? sentences.join(' ') : null
}

/* ── headlines ─────────────────────────────────────────────────────────── */

/** The Worker has already capped and balanced these; this is a backstop. */
const MAX_HEADLINES = 8

/** `2H AGO`, `YESTERDAY`, `3 DAYS AGO` — the same register as the rest. */
export function agoLabel(at: number, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - at) / 60_000)
  if (minutes < 60) return minutes <= 1 ? 'JUST NOW' : `${minutes}M AGO`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}H AGO`
  const days = Math.round(hours / 24)
  return days === 1 ? 'YESTERDAY' : `${days} DAYS AGO`
}

export function toHeadlines(raws: RawHeadline[], now: Date = new Date()): Headline[] {
  return raws
    .slice(0, MAX_HEADLINES)
    .map((h) => ({
      id: h.id,
      title: h.title,
      source: h.source,
      url: h.url,
      when: agoLabel(h.at, now),
    }))
}

/* ── the whole screen ──────────────────────────────────────────────────── */

export function toMarkets(
  quotes: RawQuote[],
  headlines: RawHeadline[],
  now: Date = new Date(),
): Markets {
  const groups = toGroups(quotes)
  const all = groups.flatMap((g) => g.quotes)

  return {
    lead: all.find((q) => q.symbol === LEAD_SYMBOL) ?? all[0] ?? null,
    groups,
    headlines: toHeadlines(headlines, now),
    brief: toBrief(groups),
  }
}

export const emptyMarkets = (): Markets => ({
  lead: null,
  groups: [],
  headlines: [],
  brief: null,
})

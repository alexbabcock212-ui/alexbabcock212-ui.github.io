/**
 * The market brief: quotes and headlines, from public feeds.
 *
 * Neither source needs a credential, so unlike the Google half of the payload
 * this could in principle be read from the browser. It is not, for two reasons
 * that are not going away: none of these hosts send CORS headers, and parsing
 * three RSS documents on a phone to show eight headlines is work better done
 * once, in a datacentre, behind the same two-minute cache as everything else.
 *
 * Nothing here is interpreted. The Worker returns last price, previous close
 * and the session's path; what a row is called, how it is rounded, and whether
 * a move reads in percent or basis points are all decided on the device — see
 * `src/data/sources/markets.ts`.
 */
import { message, settle } from './feed'
import type { Feed } from './feed'

/* ── the shapes the dashboard reads ────────────────────────────────────── */

export interface RawQuote {
  /** Yahoo's ticker, e.g. `^GSPC`. The device keys its board off this. */
  symbol: string
  price: number
  /** The previous session's close — what the day's change is measured from. */
  previousClose: number
  /** The session so far, downsampled. Empty when there is nothing to draw. */
  spark: number[]
  /** Last print, epoch ms. Says how live the row actually is. */
  at: number
}

export interface RawHeadline {
  id: string
  title: string
  /** The newsroom, for attribution. Never dropped. */
  source: string
  url: string
  /** Published, epoch ms. */
  at: number
}

export interface MarketsPayload {
  quotes: Feed<RawQuote>
  headlines: Feed<RawHeadline>
}

/* ── quotes ────────────────────────────────────────────────────────────── */

/**
 * The board, as a fetch list.
 *
 * Mostly North America, because that is what was asked for, with three
 * overseas indexes for the overnight context a morning brief needs. Kept in
 * step with the display spec in `src/data/sources/markets.ts`: a symbol only
 * this list knows about is fetched and ignored, and one only the device knows
 * about renders as missing. Neither is an error, so add to both.
 */
export const SYMBOLS = [
  '^GSPC',
  '^IXIC',
  '^DJI',
  '^RUT',
  '^GSPTSE',
  '^TNX',
  '^VIX',
  'CAD=X',
  'CL=F',
  'GC=F',
  'BTC-USD',
  '^FTSE',
  '^STOXX50E',
  '^N225',
]

/**
 * One request for the whole board.
 *
 * `spark` is the only endpoint that takes a symbol list and needs no crumb —
 * `v7/finance/quote` now answers 401 without one, and one `chart` call per
 * symbol would be fourteen subrequests out of a budget of fifty.
 *
 * Two hosts, because a shared datacentre IP gets rate-limited on one of them
 * often enough to matter, and they are independent front doors to the same
 * data. A 429 on the first is a reason to try the second, not to give up.
 */
const SPARK_HOSTS = [
  'https://query1.finance.yahoo.com/v8/finance/spark',
  'https://query2.finance.yahoo.com/v8/finance/spark',
]

/** Enough points to show the shape of a session, few enough to cache cheaply. */
const SPARK_POINTS = 32

/**
 * How this app introduces itself, to every host it talks to.
 *
 * Worth stating plainly, because it was found the hard way and both ends have
 * an opinion. The quote host answers **429** to a full Chrome string and to a
 * bare `curl/8.x` alike — a client claiming to be a browser is expected to use
 * the website, not the JSON API, and an anonymous one is expected to be a
 * scraper. The newsroom edge, in the other direction, drops a request whose
 * agent it does not recognise as a client at all.
 *
 * A generic-client token plus an honest product name satisfies both, which is
 * also the only version of this that is true. Do not "modernise" it into a real
 * browser's UA: that reintroduces the 429 and is a lie besides.
 */
const CLIENT_UA = 'Mozilla/5.0 (compatible; life-dashboard/1.0)'

interface SparkEntry {
  symbol?: string
  close?: (number | null)[]
  timestamp?: number[]
  chartPreviousClose?: number
  previousClose?: number | null
}

/** Even spacing across the session, endpoints always kept. */
function downsample(values: number[], target: number): number[] {
  if (values.length <= target) return values
  const step = (values.length - 1) / (target - 1)
  return Array.from({ length: target }, (_, i) => values[Math.round(i * step)])
}

async function fetchSpark(): Promise<Record<string, SparkEntry>> {
  const params = new URLSearchParams({
    symbols: SYMBOLS.join(','),
    range: '1d',
    interval: '5m',
  })

  let last = 'The quote service could not be reached.'
  for (const host of SPARK_HOSTS) {
    let response: Response
    try {
      response = await fetch(`${host}?${params}`, {
        headers: { 'User-Agent': CLIENT_UA, Accept: 'application/json' },
      })
    } catch (e) {
      last = message(e)
      continue
    }

    if (!response.ok) {
      last = `The quote service returned ${response.status}.`
      continue
    }

    const body = (await response.json()) as Record<string, SparkEntry>
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      last = 'The quote service answered in a shape this build does not know.'
      continue
    }
    return body
  }

  throw new Error(last)
}

export async function fetchQuotes(): Promise<RawQuote[]> {
  const body = await fetchSpark()

  const quotes: RawQuote[] = []
  for (const symbol of SYMBOLS) {
    const entry = body[symbol]
    if (!entry) continue

    // A holiday or a halted symbol comes back with the frame and no prices.
    const closes = (entry.close ?? []).filter((v): v is number => typeof v === 'number')
    const previousClose = entry.previousClose ?? entry.chartPreviousClose
    const price = closes.at(-1)
    if (typeof price !== 'number' || typeof previousClose !== 'number' || previousClose === 0) {
      continue
    }

    const stamps = entry.timestamp ?? []
    quotes.push({
      symbol,
      price,
      previousClose,
      // Four decimals covers a currency pair without inflating an index.
      spark: downsample(closes, SPARK_POINTS).map((v) => Number(v.toFixed(4))),
      at: (stamps.at(-1) ?? 0) * 1000,
    })
  }

  if (quotes.length === 0) throw new Error('The quote service returned no prices.')
  return quotes
}

/* ── headlines ─────────────────────────────────────────────────────────── */

/**
 * Three feeds: US markets, US macro, and Canada.
 *
 * All three are the newsrooms' own public RSS, which is titles and timestamps
 * and nothing else — no article text is fetched, stored or shown, and every
 * headline keeps its source and links back to it.
 */
const FEEDS = [
  { source: 'CNBC', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { source: 'CNBC', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { source: 'CBC', url: 'https://www.cbc.ca/webfeed/rss/rss-business' },
]

/**
 * Three per newsroom, not six.
 *
 * CBC publishes business copy several times an hour and CNBC does not, so a
 * straight merge by timestamp fills the screen with one masthead. Capping each
 * feed first and sorting the survivors keeps the brief both current and mixed.
 */
const PER_FEED = 3
const MAX_HEADLINES = 8

/** RSS is XML with HTML inside it; both layers have to come off. */
function decode(raw: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  }
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(item: string, name: string): string {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(item)
  return match ? decode(match[1]) : ''
}

async function fetchFeed(source: string, url: string): Promise<RawHeadline[]> {
  const response = await fetch(url, {
    headers: { 'User-Agent': CLIENT_UA, Accept: 'application/rss+xml, application/xml, text/xml' },
  })
  if (!response.ok) throw new Error(`${source} returned ${response.status}.`)

  const xml = await response.text()
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []

  return items
    .slice(0, PER_FEED)
    .map((item): RawHeadline => {
      const url = tag(item, 'link')
      const published = Date.parse(tag(item, 'pubDate'))
      return {
        id: tag(item, 'guid') || url,
        title: tag(item, 'title'),
        source,
        url,
        at: Number.isNaN(published) ? 0 : published,
      }
    })
    .filter((h) => h.title !== '' && h.at !== 0)
}

export async function fetchHeadlines(): Promise<RawHeadline[]> {
  // One dead newsroom should not cost the other two.
  const results = await Promise.all(
    FEEDS.map(({ source, url }) => fetchFeed(source, url).catch(() => [] as RawHeadline[])),
  )

  const seen = new Set<string>()
  const merged: RawHeadline[] = []
  for (const headline of results.flat().sort((a, b) => b.at - a.at)) {
    // The two CNBC feeds overlap; the same story must not appear twice.
    const key = headline.title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(headline)
    if (merged.length === MAX_HEADLINES) break
  }

  if (merged.length === 0) throw new Error('No newsroom answered.')
  return merged
}

/* ── both at once ──────────────────────────────────────────────────────── */

export async function fetchMarkets(): Promise<MarketsPayload> {
  const [quotes, headlines] = await Promise.all([
    settle(fetchQuotes()),
    settle(fetchHeadlines()),
  ])
  return { quotes, headlines }
}

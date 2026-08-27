/**
 * The dashboard's back end: one route that reads Google and the markets.
 *
 * It exists for a single reason. Google's browser-only token flow issues no
 * refresh token, so a purely static app has to re-authorize roughly hourly.
 * Holding the refresh token here — where a client secret can actually be kept —
 * turns signing in into something that happened once, in the past.
 *
 * Authorization deliberately does not live here. It runs from `npm run setup`
 * on a loopback socket, so the refresh token goes from Google to
 * `wrangler secret put` without ever being rendered in a browser. An earlier
 * version served that flow from this Worker and the token ended up pasted into
 * a chat window; a page that displays a credential is a page that invites it.
 *
 * The market brief rides along in the same payload. It needs no credential at
 * all, but it does need somewhere with CORS headers and an XML parser, and
 * this is already that place.
 */
import type { Env } from './env'
import { accessToken, fetchAll, fetchCalendarList } from './google'
import { fetchMarkets } from './markets'
import type { MarketsPayload } from './markets'

/** How long a fetched payload may be reused. `?fresh=1` skips it. */
const CACHE_SECONDS = 120

/**
 * How long the last board that actually worked is kept as a fallback.
 *
 * The quote host rate-limits shared datacentre addresses, and a 429 that lasts
 * a minute must not blank a screen that was correct two minutes ago. Serving
 * the last good board is honest here in a way it would not be for a calendar:
 * every row carries the timestamp of its own last print and the screen shows
 * it, so a stale board says on its face that it is stale.
 */
const LAST_GOOD_SECONDS = 1800

/* ── CORS ──────────────────────────────────────────────────────────────── */

const allowed = (env: Env) =>
  env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin || !allowed(env).includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    // The allowed origin varies per request, so caches must key on it.
    Vary: 'Origin',
  }
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })

/* ── authorization ─────────────────────────────────────────────────────── */

/**
 * Compare without leaking length or position through timing.
 *
 * `crypto.subtle.timingSafeEqual` is not in the Workers runtime, so this does
 * the usual constant-time XOR fold over equal-length digests.
 */
async function secretsMatch(a: string, b: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [x, y] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

function bearer(request: Request): string {
  const header = request.headers.get('Authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/* ── the market board ──────────────────────────────────────────────────── */

async function marketsWithFallback(origin: string): Promise<MarketsPayload> {
  const key = new Request(`${origin}/__cache/markets`)
  const markets = await fetchMarkets()

  if (markets.quotes.ok) {
    await caches.default.put(
      key,
      new Response(JSON.stringify(markets), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `max-age=${LAST_GOOD_SECONDS}`,
        },
      }),
    )
    return markets
  }

  const hit = await caches.default.match(key)
  if (!hit) return markets

  // Only the quotes fall back. Headlines that were read this time are newer
  // than the ones stored with that board, and should not be rolled back.
  const last = (await hit.json()) as MarketsPayload
  return {
    quotes: last.quotes,
    headlines: markets.headlines.ok ? markets.headlines : last.headlines,
  }
}

/* ── the API ───────────────────────────────────────────────────────────── */

async function dashboard(request: Request, url: URL, env: Env, cors: Record<string, string>) {
  if (!(await secretsMatch(bearer(request), env.DASHBOARD_TOKEN))) {
    return json({ error: 'Unauthorized' }, 401, cors)
  }

  const fresh = url.searchParams.get('fresh') === '1'
  // Key on a fixed URL so the cache is shared by every caller and never keyed
  // on the bearer token, which must not end up in a cache key.
  const cacheKey = new Request(`${url.origin}/__cache/dashboard`)
  const cache = caches.default

  if (!fresh) {
    const hit = await cache.match(cacheKey)
    if (hit) {
      const body = await hit.text()
      return new Response(body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'hit', ...cors },
      })
    }
  }

  // The two halves share nothing but the cache, so they run side by side.
  const [google, markets] = await Promise.all([fetchAll(env), marketsWithFallback(url.origin)])
  const payload = { ...google, ...markets }
  const body = JSON.stringify(payload)

  // Only cache a read that actually worked; caching an outage would extend it.
  if (payload.calendar.ok || payload.tasks.ok || payload.quotes.ok) {
    await cache.put(
      cacheKey,
      new Response(body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `max-age=${CACHE_SECONDS}`,
        },
      }),
    )
  }

  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'miss', ...cors },
  })
}

/* ── routing ───────────────────────────────────────────────────────────── */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors)

    switch (url.pathname) {
      case '/api/dashboard':
        return dashboard(request, url, env, cors)

      // Diagnostic: which calendars exist, and which ones a read would cover.
      // Gated on the device key like everything else — calendar names are
      // personal data.
      case '/api/calendars': {
        if (!(await secretsMatch(bearer(request), env.DASHBOARD_TOKEN))) {
          return json({ error: 'Unauthorized' }, 401, cors)
        }
        try {
          return json({ calendars: await fetchCalendarList(await accessToken(env)) }, 200, cors)
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 502, cors)
        }
      }

      case '/health':
        return json({ ok: true }, 200, cors)

      default:
        return json({ error: 'Not found' }, 404, cors)
    }
  },
}

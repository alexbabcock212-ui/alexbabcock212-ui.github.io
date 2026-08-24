/**
 * The dashboard's back end: one route that reads Google, and nothing else.
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
 */
import type { Env } from './env'
import { fetchAll } from './google'

/** How long a fetched payload may be reused. `?fresh=1` skips it. */
const CACHE_SECONDS = 120

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

  const payload = await fetchAll(env)
  const body = JSON.stringify(payload)

  // Only cache a read that actually worked; caching an outage would extend it.
  if (payload.calendar.ok || payload.tasks.ok || payload.mail.ok) {
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

      case '/health':
        return json({ ok: true }, 200, cors)

      default:
        return json({ error: 'Not found' }, 404, cors)
    }
  },
}

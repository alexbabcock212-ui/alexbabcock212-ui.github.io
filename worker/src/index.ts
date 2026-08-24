/**
 * The dashboard's back end: one route that reads Google, one flow that sets it
 * up, and nothing else.
 *
 * It exists for a single reason. Google's browser-only token flow issues no
 * refresh token, so a purely static app has to re-authorize roughly hourly.
 * Moving the exchange here — where a client secret can actually be kept —
 * turns signing in into something that happens once, ever.
 */
import type { Env } from './env'
import { SCOPES, exchangeCode, fetchAll } from './google'

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

/* ── the setup flow ────────────────────────────────────────────────────── */

const escape = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<style>body{font:16px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.25rem;color:#1d2d3d}` +
      `code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}` +
      `pre{background:#f2f4f6;padding:1rem;border-radius:6px;overflow-x:auto;user-select:all}` +
      `h1{font-size:1.5rem}` +
      `.warn{background:#fdf2f2;border-left:3px solid #b3261e;padding:.75rem 1rem}` +
      `button{font:inherit;padding:.5rem .9rem;background:#1d2d3d;color:#fff;border:0;cursor:pointer}` +
      `button:hover{background:#2c455d}` +
      `#m{margin-left:.75rem;color:#5d5d60}</style>${body}`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

/**
 * Step one of setup: send the browser to Google's consent screen.
 *
 * `access_type=offline` with `prompt=consent` is what makes Google part with a
 * refresh token — and it only does so on a *fresh* consent, which is why the
 * prompt is forced rather than skipped.
 */
function authStart(url: URL, env: Env): Response {
  const redirectUri = `${url.origin}/auth/callback`
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  google.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  }).toString()

  return Response.redirect(google.toString(), 302)
}

async function authCallback(url: URL, env: Env): Promise<Response> {
  const error = url.searchParams.get('error')
  if (error) return page('Authorization failed', `<h1>Google said no</h1><p><code>${error}</code></p>`, 400)

  const code = url.searchParams.get('code')
  if (!code) return page('Missing code', '<h1>No authorization code</h1>', 400)

  const { refreshToken, error: exchangeError } = await exchangeCode(
    env,
    code,
    `${url.origin}/auth/callback`,
  )

  // The exchange itself failed. Name the cause: these are the three that
  // actually happen, and each sends you somewhere completely different.
  if (exchangeError) {
    const hint = exchangeError.startsWith('invalid_client')
      ? `<p><strong>GOOGLE_CLIENT_SECRET is missing or wrong.</strong> Set it with
         <code>pbpaste | npx wrangler secret put GOOGLE_CLIENT_SECRET</code> and try again.</p>`
      : exchangeError.startsWith('redirect_uri_mismatch')
        ? `<p><strong>The redirect URI is not registered.</strong> Add
           <code>${url.origin}/auth/callback</code> to the OAuth client's authorized
           redirect URIs, exactly, and try again.</p>`
        : exchangeError.startsWith('invalid_grant')
          ? `<p><strong>This authorization code was already used or has expired.</strong>
             They are single-use and short-lived. Start again from <code>/auth/start</code>.</p>`
          : ''

    return page(
      'Exchange failed',
      `<h1>Google refused the exchange</h1>
       <pre>${escape(exchangeError)}</pre>${hint}`,
      400,
    )
  }

  // The exchange worked but carried no refresh token, which means one thing
  // only: this account already has a live grant for the client.
  if (!refreshToken) {
    return page(
      'No refresh token',
      `<h1>Consent succeeded, but Google issued no refresh token</h1>
       <p>Google only returns one on a <em>fresh</em> grant. This account already
       has a live grant for this client, so revoke it at
       <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>
       and run <code>/auth/start</code> again.</p>`,
      400,
    )
  }

  // The token is deliberately not rendered as selectable prose.
  //
  // The obvious page — instructions with the token in a <pre> underneath — reads
  // as one block to be copied somewhere, and the somewhere is not always a
  // terminal. A refresh token is the most sensitive thing in this whole setup:
  // it is standing read access to a calendar, a task list and an inbox. So the
  // value goes to the clipboard by button and is shown only as a masked stub.
  const masked = `${escape(refreshToken.slice(0, 8))}${'\u2022'.repeat(24)}`

  return page(
    'Refresh token',
    `<h1>Consent granted</h1>
     <p class="warn"><strong>This is a live credential.</strong> It grants ongoing
     read access to your calendar, tasks and mail. Put it in your terminal and
     nowhere else — not a chat, not an email, not a note.</p>
     <p>Run this first, then come back and press Copy:</p>
     <pre>./worker/set-secret.sh GOOGLE_REFRESH_TOKEN</pre>
     <p>
       <button id="c" data-t="${escape(refreshToken)}">Copy token to clipboard</button>
       <code id="m">${masked}</code>
     </p>
     <p id="s"></p>
     <script>
       const b = document.getElementById('c');
       b.addEventListener('click', async () => {
         try {
           await navigator.clipboard.writeText(b.dataset.t);
           document.getElementById('s').textContent =
             'Copied. Paste it at the prompt in your terminal, then close this tab.';
           b.textContent = 'Copied';
         } catch {
           document.getElementById('s').textContent =
             'Clipboard blocked by the browser. Select the value below and copy it by hand.';
           document.getElementById('m').textContent = b.dataset.t;
         }
       });
     </script>`,
  )
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

      // Setup routes are gated on a separate secret, passed in the query string
      // because a browser redirect cannot carry an Authorization header.
      case '/auth/start': {
        const key = url.searchParams.get('key') ?? ''
        if (!(await secretsMatch(key, env.SETUP_TOKEN))) return page('Nope', '<h1>Not found</h1>', 404)
        return authStart(url, env)
      }
      case '/auth/callback':
        return authCallback(url, env)

      case '/health':
        return json({ ok: true }, 200, cors)

      default:
        return json({ error: 'Not found' }, 404, cors)
    }
  },
}

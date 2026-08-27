#!/usr/bin/env node
/**
 * One command that takes the dashboard from nothing to working.
 *
 * This replaces a manual sequence of five credentials shuttled by hand between
 * a browser, a terminal and the Cloudflare dashboard. That sequence failed six
 * times in six different ways — a secret stored under its own value as a name,
 * a clipboard clobbered by the very command that read it, a token echoed by a
 * dropped shell quote. None of those were possible to catch at the time,
 * because nothing verified itself.
 *
 * So the design rule here is: **every step proves itself before the next one
 * runs**, and no credential is ever displayed, retyped, or moved between
 * windows. The authorization code arrives on a loopback socket, the exchange
 * happens in this process, and the refresh token goes straight into
 * `wrangler secret put` without touching a screen.
 *
 *   npm run setup
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import {
  AUTH_URL,
  LOOPBACK_PORT,
  LOOPBACK_URI,
  SCOPES,
  SHAPES,
  accessTokenFrom,
  bad,
  checkScopes,
  die,
  head,
  hiddenPrompt,
  note,
  ok,
  openBrowser,
  prompt,
  probeCredentials,
  putSecret,
  randomToken,
  readEnvFile,
  run,
  shapeOf,
  upsertEnvLine,
  workerDashboard,
  workerHealth,
} from './lib/setup-lib.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const WORKER = resolve(ROOT, 'worker')
const ENV = resolve(ROOT, '.env')
const SECRETS = resolve(ROOT, '.secrets.local')

const CONSENT_TIMEOUT_MS = 5 * 60 * 1000

/* ── 1. preflight ──────────────────────────────────────────────────────── */

async function preflight() {
  head('1. Preflight')

  const who = await run('npx', ['wrangler', 'whoami'], { cwd: WORKER })
  if (who.code !== 0 || /not authenticated/i.test(who.stdout + who.stderr)) {
    die('Not logged in to Cloudflare.', 'cd worker && npx wrangler login')
  }
  const email = /email (\S+?)\.?$/im.exec(who.stdout)?.[1] ?? 'unknown account'
  ok('wrangler is authenticated', email)

  const env = readEnvFile(ENV)
  let base = (env.VITE_API_BASE ?? '').replace(/\/+$/, '')
  if (!base) {
    base = (await prompt('  Worker URL (https://…workers.dev): ')).replace(/\/+$/, '')
    if (!base) die('No Worker URL given.', 'cd worker && npx wrangler deploy')
  }

  if (!(await workerHealth(base))) {
    die(`Worker at ${base} did not answer /health.`, 'cd worker && npx wrangler deploy')
  }
  ok('Worker is reachable', base)

  return base
}

/* ── 2. credentials ────────────────────────────────────────────────────── */

async function credentials() {
  head('2. Google credentials')
  note('From console.cloud.google.com/apis/credentials, your Web application client.')

  const stored = readEnvFile(SECRETS)
  const suggested = stored.GOOGLE_CLIENT_ID ?? ''

  const clientId = await prompt(
    suggested ? `  Client ID [${suggested.slice(0, 20)}…]: ` : '  Client ID: ',
    suggested,
  )
  if (!SHAPES.GOOGLE_CLIENT_ID.test(clientId)) {
    die(
      `That is not a client ID (${shapeOf(clientId)}).`,
      `Expected: ${SHAPES.GOOGLE_CLIENT_ID.expect}`,
    )
  }
  ok('client ID looks right')

  const clientSecret = await hiddenPrompt('  Client secret (hidden, paste and press Enter): ')
  if (!SHAPES.GOOGLE_CLIENT_SECRET.test(clientSecret)) {
    die(
      `That is not a client secret (${shapeOf(clientSecret)}).`,
      `Expected: ${SHAPES.GOOGLE_CLIENT_SECRET.expect}`,
      'If you pasted the client ID by mistake, they look similar in the Console —',
      'the secret is the short one in the right-hand panel.',
    )
  }
  ok('client secret looks right', shapeOf(clientSecret))

  return { clientId, clientSecret }
}

/* ── 3. the probe ──────────────────────────────────────────────────────── */

async function probe(clientId, clientSecret) {
  head('3. Verify credentials with Google')
  note('Posting a junk authorization code — consumes nothing, needs no consent.')

  const { verdict, error, detail } = await probeCredentials(clientId, clientSecret)

  if (verdict === 'credentials-ok') {
    ok('Google accepted the client ID and secret')
    ok('loopback redirect URI is registered', LOOPBACK_URI)
    return
  }
  if (verdict === 'bad-secret') {
    die(
      `Google rejected the credentials — ${detail || error}`,
      'On the Credentials page, open your Web application client:',
      '  1. Delete every listed secret except one (Add secret if none remain)',
      '  2. Copy that one with the copy icon',
      '  3. Run npm run setup again and paste it',
    )
  }
  if (verdict === 'uri-not-registered') {
    die(
      'Credentials are valid, but the loopback redirect URI is not registered.',
      'On the Credentials page, under Authorized redirect URIs, add exactly:',
      '',
      `  ${LOOPBACK_URI}`,
      '',
      'Save, wait a few seconds, then run npm run setup again.',
    )
  }
  die(`Unexpected reply from Google: ${error} ${detail}`)
}

/* ── 4. consent, over a loopback socket ────────────────────────────────── */

const closeTab = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font:16px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:32rem;` +
  `margin:4rem auto;padding:0 1.5rem;color:#1d2d3d}h1{font-size:1.4rem}</style>` +
  `<h1>${title}</h1><p>${body}</p>`

function consent(clientId) {
  const state = randomBytes(16).toString('hex')

  const url = new URL(AUTH_URL)
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: LOOPBACK_URI,
    response_type: 'code',
    scope: SCOPES,
    // The pair that makes Google part with a refresh token, and it only does so
    // on a *fresh* grant — hence forcing the prompt rather than skipping it.
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString()

  return new Promise((resolvePromise, reject) => {
    let timer

    const server = createServer((req, res) => {
      const got = new URL(req.url, `http://localhost:${LOOPBACK_PORT}`)
      if (got.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }

      const finish = (title, body, err, code) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(closeTab(title, body))
        clearTimeout(timer)
        server.close()
        if (err) reject(err)
        else resolvePromise(code)
      }

      const error = got.searchParams.get('error')
      if (error) {
        return finish('Authorization refused', `Google said: ${error}`, new Error(error))
      }
      // Guards against a stray request to the loopback port landing here.
      if (got.searchParams.get('state') !== state) {
        return finish('State mismatch', 'Discarded.', new Error('state mismatch'))
      }
      const code = got.searchParams.get('code')
      if (!code) return finish('No code', 'Nothing to exchange.', new Error('no code'))

      finish('Authorized', 'You can close this tab and return to the terminal.', null, code)
    })

    server.on('error', (e) =>
      reject(
        e.code === 'EADDRINUSE'
          ? new Error(
              `port ${LOOPBACK_PORT} is already in use — close whatever is using it and retry`,
            )
          : e,
      ),
    )

    server.listen(LOOPBACK_PORT, '127.0.0.1', async () => {
      ok(`listening on ${LOOPBACK_URI}`)
      note('A browser window is opening. Approve all three read-only permissions.')
      note('If you see "Google hasn\'t verified this app": Advanced -> Go to ... (unsafe)')
      await openBrowser(url.toString())
    })

    timer = setTimeout(() => {
      server.close()
      reject(new Error('timed out waiting for consent'))
    }, CONSENT_TIMEOUT_MS)
  })
}

async function exchange(clientId, clientSecret, code) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: LOOPBACK_URI,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.error) {
    throw new Error(body.error_description ?? body.error ?? `HTTP ${response.status}`)
  }
  if (!body.refresh_token) {
    throw new Error(
      'consent succeeded but Google issued no refresh token — revoke at ' +
        'myaccount.google.com/permissions and run setup again',
    )
  }
  return body.refresh_token
}

/* ── run ───────────────────────────────────────────────────────────────── */

async function main() {
  console.log('\nLife Dashboard setup')

  const base = await preflight()
  const { clientId, clientSecret } = await credentials()
  await probe(clientId, clientSecret)

  head('4. Consent')
  let refreshToken
  try {
    const code = await consent(clientId)
    ok('authorization code received')
    refreshToken = await exchange(clientId, clientSecret, code)
    ok('refresh token minted', shapeOf(refreshToken))
  } catch (e) {
    die(`Consent failed: ${e.message}`)
  }

  head('5. Verify the token can actually read')
  let accessToken
  try {
    accessToken = await accessTokenFrom(clientId, clientSecret, refreshToken)
    ok('refresh token exchanges for an access token')
  } catch (e) {
    die(`The new refresh token does not work: ${e.message}`)
  }

  const scopes = await checkScopes(accessToken)
  for (const s of scopes) (s.ok ? ok : bad)(s.label, s.detail)
  if (scopes.some((s) => !s.ok)) {
    die(
      'At least one API is not readable with this token.',
      'Usually a disabled API or a missing scope on the consent screen.',
      'Enable the Calendar and Tasks APIs, add the two readonly scopes,',
      'then run npm run setup again.',
    )
  }

  head('6. Store the secrets in the Worker')
  const stored = readEnvFile(SECRETS)
  const deviceKey = stored.DASHBOARD_TOKEN || randomToken()
  const fresh = !stored.DASHBOARD_TOKEN

  try {
    for (const [name, value] of [
      ['GOOGLE_CLIENT_ID', clientId],
      ['GOOGLE_CLIENT_SECRET', clientSecret],
      ['GOOGLE_REFRESH_TOKEN', refreshToken],
      ['DASHBOARD_TOKEN', deviceKey],
    ]) {
      await putSecret(name, value, WORKER)
      ok(`stored ${name}`)
    }
  } catch (e) {
    die(`Could not store a secret: ${e.message}`)
  }

  // Kept locally so the device key survives a re-run and the phone URL can be
  // rebuilt without another round trip. Client secret is deliberately not kept.
  upsertEnvLine(SECRETS, 'GOOGLE_CLIENT_ID', clientId)
  upsertEnvLine(SECRETS, 'DASHBOARD_TOKEN', deviceKey)
  ok(fresh ? 'generated a new device key' : 'reused the existing device key')

  head('7. Wire the front end')
  upsertEnvLine(ENV, 'VITE_API_BASE', base)
  ok('VITE_API_BASE written to .env')

  head('8. End to end, through the Worker')
  try {
    const payload = await workerDashboard(base, deviceKey)
    let broken = 0
    for (const feed of ['calendar', 'allDay', 'tasks', 'quotes', 'headlines']) {
      const f = payload[feed] ?? {}
      const n = (f.items ?? []).length
      if (f.ok) ok(feed, `${n} item${n === 1 ? '' : 's'}`)
      else {
        bad(feed, f.error ?? 'unknown error')
        broken++
      }
    }
    if (broken) die('The Worker could not read everything. See the errors above.')
  } catch (e) {
    die(`The Worker call failed: ${e.message}`)
  }

  const site = (await run('git', ['remote', 'get-url', 'origin'], { cwd: ROOT })).stdout.trim()
  const host = /([^/]+?)(?:\.git)?$/.exec(site)?.[1] ?? 'your-site'
  const phoneUrl = `https://${host}/#key=${deviceKey}`
  upsertEnvLine(SECRETS, 'PHONE_URL', phoneUrl)

  head('Done')
  note('Everything verified. Next:')
  console.log()
  console.log('    npm run deploy')
  console.log()
  note('Then open the phone URL once, and Add to Home Screen.')
  note('It is in .secrets.local as PHONE_URL — not printed here, so it stays')
  note('out of your scrollback. Open it with:')
  console.log()
  console.log('    open "$(grep ^PHONE_URL .secrets.local | cut -d= -f2-)"')
  console.log()
}

main().catch((e) => {
  console.error()
  bad(`Unexpected failure: ${e?.stack ?? e}`)
  process.exit(1)
})

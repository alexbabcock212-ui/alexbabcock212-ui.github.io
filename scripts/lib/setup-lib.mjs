/**
 * Shared plumbing for `npm run setup` and `npm run doctor`.
 *
 * No dependencies, matching scripts/make-icons.mjs — this runs before anything
 * is configured, so it cannot rely on anything being installed.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

/* ── output ────────────────────────────────────────────────────────────── */

// Escaped rather than literal: a raw ESC byte in source is invisible in a
// diff and gets mangled by anything that reflows the file. Colour is dropped
// entirely when stdout is not a terminal, so piped output stays readable.
const E = '\u001b'
const paint = (code, s) => (process.stdout.isTTY ? `${E}[${code}m${s}${E}[0m` : s)
const dim = (s) => paint('2', s)

export const ok = (msg, detail = '') =>
  console.log(`  ${paint('32', '✓')} ${msg}${detail ? ` ${dim(detail)}` : ''}`)
export const bad = (msg, detail = '') =>
  console.log(`  ${paint('31', '✗')} ${msg}${detail ? ` ${dim(detail)}` : ''}`)
export const warn = (msg) => console.log(`  ${paint('33', '!')} ${msg}`)
export const note = (msg) => console.log(`    ${dim(msg)}`)
export const head = (msg) => console.log(`\n${paint('1', msg)}`)

/** Print a remedy block and exit non-zero. */
export function die(msg, ...remedy) {
  bad(msg)
  if (remedy.length) {
    console.log()
    for (const line of remedy) console.log(`    ${line}`)
  }
  console.log()
  process.exit(1)
}

/* ── files ─────────────────────────────────────────────────────────────── */

/** Parse `KEY=value` lines, ignoring comments. */
export function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/**
 * Set one `KEY=value`, preserving every other line and all comments.
 *
 * Rewriting these files wholesale would throw away the explanatory comments in
 * `.env` and `.secrets.local`, which are the only documentation of what those
 * values are for.
 */
export function upsertEnvLine(path, key, value) {
  const line = `${key}=${value}`
  if (!existsSync(path)) {
    writeFileSync(path, `${line}\n`, { mode: 0o600 })
    return
  }
  const src = readFileSync(path, 'utf8')
  const re = new RegExp(`^${key}=.*$`, 'm')
  writeFileSync(path, re.test(src) ? src.replace(re, line) : `${src.replace(/\n*$/, '\n')}${line}\n`)
}

export const randomToken = () => randomBytes(32).toString('hex')

/* ── prompts ───────────────────────────────────────────────────────────── */

/** Ask for a value without echoing it. */
export function hiddenPrompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    let muted = false
    // readline has no masking of its own; overriding the writer is the
    // documented way to suppress the echo without losing the prompt.
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer.trim())
    })
    muted = true
  })
}

export function prompt(question, fallback = '') {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim() || fallback)
    })
  })
}

/* ── shape checks ──────────────────────────────────────────────────────── */

export const SHAPES = {
  GOOGLE_CLIENT_ID: {
    test: (v) => v.endsWith('.apps.googleusercontent.com') && v.length > 30,
    expect: 'ends with .apps.googleusercontent.com',
  },
  GOOGLE_CLIENT_SECRET: {
    test: (v) => /^GOCSPX-[A-Za-z0-9_-]{20,}$/.test(v),
    expect: 'GOCSPX- followed by ~28 characters',
  },
  GOOGLE_REFRESH_TOKEN: {
    test: (v) => /^1\/\/[A-Za-z0-9_.-]{20,}$/.test(v),
    expect: 'starts with 1//',
  },
}

/** Describe a value without revealing it. */
export const shapeOf = (v) => `${v.length} chars starting '${v.slice(0, 7)}'`

/* ── subprocess ────────────────────────────────────────────────────────── */

/** Run a command, optionally feeding stdin. Resolves `{ code, stdout, stderr }`. */
export function run(cmd, args, { input, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    if (input !== undefined) {
      child.stdin.write(input)
      child.stdin.end()
    }
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.on('error', (e) => resolve({ code: 1, stdout, stderr: String(e) }))
  })
}

export const openBrowser = (url) => run('open', [url])

/* ── Google ────────────────────────────────────────────────────────────── */

export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
].join(' ')

export const LOOPBACK_PORT = 8976
export const LOOPBACK_URI = `http://localhost:${LOOPBACK_PORT}/callback`

/**
 * Check a client ID and secret without consuming anything.
 *
 * Posts a deliberately junk authorization code. Google validates the *client*
 * before it looks at the code, so the error it returns says which half is
 * wrong — a free check that needs no consent and can be repeated at will. The
 * absence of this step is what made every earlier failure look like a different
 * problem than it actually was.
 */
export async function probeCredentials(clientId, clientSecret, redirectUri = LOOPBACK_URI) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: 'probe-not-a-real-code',
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })
  const body = await response.json().catch(() => ({}))
  const error = body.error ?? `http_${response.status}`
  const detail = body.error_description ?? ''

  // Reaching "the code is bad" means the client credentials were accepted.
  if (error === 'invalid_grant') return { verdict: 'credentials-ok', error, detail }
  if (error === 'invalid_client') return { verdict: 'bad-secret', error, detail }
  if (error === 'redirect_uri_mismatch') return { verdict: 'uri-not-registered', error, detail }
  return { verdict: 'unknown', error, detail }
}

/** Trade a refresh token for an access token. */
export async function accessTokenFrom(clientId, clientSecret, refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? `HTTP ${response.status}`)
  }
  return body.access_token
}

/** Read from each API, so a scope problem surfaces here rather than on a phone. */
export async function checkScopes(accessToken) {
  const call = async (label, url) => {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) return { label, ok: false, detail: b.error?.message ?? `HTTP ${r.status}` }
      const n = (b.items ?? b.messages ?? []).length
      return { label, ok: true, detail: `${n} item${n === 1 ? '' : 's'}` }
    } catch (e) {
      return { label, ok: false, detail: String(e) }
    }
  }

  const now = new Date().toISOString()
  return Promise.all([
    call(
      'calendar',
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5&timeMin=${now}&singleEvents=true&orderBy=startTime`,
    ),
    call('tasks', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=5'),
  ])
}

/* ── the Worker ────────────────────────────────────────────────────────── */

export async function workerHealth(base) {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) })
    return r.ok
  } catch {
    return false
  }
}

export async function workerDashboard(base, deviceKey) {
  const r = await fetch(`${base}/api/dashboard?fresh=1`, {
    headers: { Authorization: `Bearer ${deviceKey}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (r.status === 401) throw new Error('401 — the Worker rejected this device key.')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** Push one secret to the Worker, feeding the value on stdin. */
export async function putSecret(name, value, workerDir) {
  const { code, stdout, stderr } = await run('npx', ['wrangler', 'secret', 'put', name], {
    input: value,
    cwd: workerDir,
  })
  if (code !== 0) throw new Error(`${name}: ${(stderr || stdout).trim().slice(0, 300)}`)
}

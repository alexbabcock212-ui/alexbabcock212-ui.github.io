/**
 * Google, as far as this Worker is concerned.
 *
 * One refresh token in, three read-only feeds out. Every fetch is best-effort
 * and reports its own failure: a dead Gmail call must not blank the timetable,
 * so each source returns `{ ok: false, error }` instead of throwing.
 */
import type { Env } from './env'

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ')

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/* ── access tokens ─────────────────────────────────────────────────────── */

/**
 * Isolates live for a few minutes at a time, so this saves a token round-trip
 * on bursts of requests without ever being something we can rely on.
 */
let cached: { token: string; expiresAt: number } | null = null

/** Spend a token slightly early so it cannot die mid-request. */
const SKEW_MS = 60_000

export async function accessToken(env: Env): Promise<string> {
  if (cached && cached.expiresAt - SKEW_MS > Date.now()) return cached.token

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })

  const body = (await response.json()) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  if (!response.ok || !body.access_token) {
    // `invalid_grant` is the one worth naming: it means the refresh token was
    // revoked or expired, and only re-running /auth/start fixes it.
    const detail = body.error_description ?? body.error ?? `HTTP ${response.status}`
    throw new Error(
      body.error === 'invalid_grant'
        ? `Google rejected the refresh token (${detail}). Re-run /auth/start to mint a new one.`
        : `Could not refresh the Google access token: ${detail}`,
    )
  }

  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return cached.token
}

/** Exchange a one-time authorization code for a refresh token. Setup only. */
export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string | null; raw: unknown }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })

  const raw = (await response.json()) as { refresh_token?: string }
  return { refreshToken: raw.refresh_token ?? null, raw }
}

/* ── the shapes the dashboard reads ────────────────────────────────────── */

export interface RawEvent {
  id: string
  title: string
  location: string
  /** ISO 8601. Timed events only — see the filter in `fetchCalendar`. */
  start: string
  end: string
}

export interface RawAllDay {
  id: string
  title: string
  /** `YYYY-MM-DD`, the calendar's own date form for all-day entries. */
  date: string
}

export interface RawTask {
  id: string
  title: string
  notes: string
  /** ISO 8601, or null when the task has no due date. */
  due: string | null
  list: string
}

export interface RawMessage {
  id: string
  threadId: string
  /** Display name where Gmail supplies one, otherwise the bare address. */
  from: string
  address: string
  subject: string
  /** Epoch ms. */
  date: number
}

export interface Feed<T> {
  ok: boolean
  items: T[]
  error?: string
}

export interface Payload {
  fetchedAt: number
  calendar: Feed<RawEvent>
  allDay: Feed<RawAllDay>
  tasks: Feed<RawTask>
  mail: Feed<RawMessage>
}

/** How far ahead the calendar and task windows reach. */
export const HORIZON_DAYS = 14

/* ── helpers ───────────────────────────────────────────────────────────── */

async function api<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${new URL(url).pathname} returned ${response.status}. ${text.slice(0, 200)}`)
  }
  return (await response.json()) as T
}

/** Run `work` over `items` with at most `limit` in flight. */
async function pooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i])
  })
  await Promise.all(workers)
  return out
}

const startOfDay = (d: Date) => {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

/* ── calendar ──────────────────────────────────────────────────────────── */

interface ApiEvent {
  id: string
  summary?: string
  location?: string
  status?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

/**
 * Timed events and all-day entries, kept apart.
 *
 * They answer different questions: a timed event belongs on the hour-by-hour
 * timeline, while an all-day entry is almost always a due date, so it belongs
 * on the DUE screen next to the tasks.
 */
export async function fetchCalendar(
  token: string,
  now: Date,
): Promise<{ timed: RawEvent[]; allDay: RawAllDay[] }> {
  const params = new URLSearchParams({
    timeMin: startOfDay(now).toISOString(),
    timeMax: addDays(startOfDay(now), HORIZON_DAYS).toISOString(),
    // Expand recurring events into individual occurrences.
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })

  const body = await api<{ items?: ApiEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    token,
  )

  const live = (body.items ?? []).filter((e) => e.status !== 'cancelled')

  return {
    timed: live
      .filter((e) => e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({
        id: e.id,
        title: e.summary?.trim() || '(no title)',
        location: e.location?.trim() ?? '',
        start: e.start!.dateTime!,
        end: e.end!.dateTime!,
      })),
    allDay: live
      .filter((e) => e.start?.date && !e.start.dateTime)
      .map((e) => ({
        id: e.id,
        title: e.summary?.trim() || '(no title)',
        date: e.start!.date!,
      })),
  }
}

/* ── tasks ─────────────────────────────────────────────────────────────── */

interface ApiTaskList {
  id: string
  title?: string
}

interface ApiTask {
  id: string
  title?: string
  notes?: string
  due?: string
  status?: string
  deleted?: boolean
}

/** Every open task across every list, due date or not. */
export async function fetchTasks(token: string): Promise<RawTask[]> {
  const lists = await api<{ items?: ApiTaskList[] }>(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=50',
    token,
  )

  const perList = await pooled(lists.items ?? [], 4, async (list) => {
    const params = new URLSearchParams({
      showCompleted: 'false',
      showDeleted: 'false',
      showHidden: 'false',
      maxResults: '100',
    })
    const body = await api<{ items?: ApiTask[] }>(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${params}`,
      token,
    )
    return (body.items ?? [])
      .filter((t) => !t.deleted && t.status !== 'completed' && t.title?.trim())
      .map((t): RawTask => ({
        id: t.id,
        title: t.title!.trim(),
        notes: t.notes?.trim() ?? '',
        due: t.due ?? null,
        list: list.title?.trim() ?? '',
      }))
  })

  return perList.flat()
}

/* ── mail ──────────────────────────────────────────────────────────────── */

interface ApiMessageRef {
  id: string
  threadId: string
}

interface ApiMessage {
  id: string
  threadId: string
  internalDate?: string
  payload?: { headers?: { name: string; value: string }[] }
}

/**
 * Unread inbox mail from the last fortnight. Senders, subjects and timestamps.
 *
 * Gmail returns a `snippet` — an excerpt of the message body — on every read,
 * `format=metadata` included. Nothing displays it, so it is dropped here rather
 * than carried to the device: it is the difference between the privacy policy
 * saying "no message bodies" and having to qualify it.
 */
const MAIL_QUERY = 'is:unread in:inbox newer_than:14d'
const MAIL_LIMIT = 40

/** `Jane Doe <jane@x.com>` → name and address, either of which may be absent. */
function parseFrom(value: string): { from: string; address: string } {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value)
  if (!angled) {
    const bare = value.trim()
    return { from: bare, address: bare }
  }
  const address = angled[2].trim()
  const name = angled[1].replace(/^"|"$/g, '').trim()
  return { from: name || address, address }
}

export async function fetchMail(token: string): Promise<RawMessage[]> {
  const params = new URLSearchParams({ q: MAIL_QUERY, maxResults: String(MAIL_LIMIT) })
  const list = await api<{ messages?: ApiMessageRef[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    token,
  )

  const refs = list.messages ?? []
  if (refs.length === 0) return []

  // `format=metadata` with an explicit header list is the narrowest read Gmail
  // offers: subject lines and senders, never message bodies.
  const headerParams = new URLSearchParams({ format: 'metadata' })
  for (const h of ['From', 'Subject', 'Date']) headerParams.append('metadataHeaders', h)

  const messages = await pooled(refs, 8, async (ref) => {
    try {
      return await api<ApiMessage>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?${headerParams}`,
        token,
      )
    } catch {
      // One unreadable message should not cost us the other thirty-nine.
      return null
    }
  })

  return messages
    .filter((m): m is ApiMessage => m !== null)
    .map((m): RawMessage => {
      const headers = new Map(
        (m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
      )
      const { from, address } = parseFrom(headers.get('from') ?? '')
      return {
        id: m.id,
        threadId: m.threadId,
        from,
        address,
        subject: headers.get('subject')?.trim() ?? '(no subject)',
        date: Number(m.internalDate ?? 0),
      }
    })
    .sort((a, b) => b.date - a.date)
}

/* ── everything at once ────────────────────────────────────────────────── */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * All three feeds in parallel, each allowed to fail on its own.
 *
 * A token failure is the exception: nothing can succeed without one, so it is
 * reported identically on every feed rather than three times over.
 */
export async function fetchAll(env: Env, now = new Date()): Promise<Payload> {
  let token: string
  try {
    token = await accessToken(env)
  } catch (e) {
    const error = message(e)
    const dead = { ok: false, items: [], error }
    return { fetchedAt: Date.now(), calendar: dead, allDay: dead, tasks: dead, mail: dead }
  }

  const [calendar, tasks, mail] = await Promise.all([
    fetchCalendar(token, now).then(
      (r) => ({ timed: r.timed, allDay: r.allDay, error: undefined as string | undefined }),
      (e) => ({ timed: [] as RawEvent[], allDay: [] as RawAllDay[], error: message(e) }),
    ),
    fetchTasks(token).then(
      (items) => ({ items, error: undefined as string | undefined }),
      (e) => ({ items: [] as RawTask[], error: message(e) }),
    ),
    fetchMail(token).then(
      (items) => ({ items, error: undefined as string | undefined }),
      (e) => ({ items: [] as RawMessage[], error: message(e) }),
    ),
  ])

  return {
    fetchedAt: Date.now(),
    calendar: { ok: !calendar.error, items: calendar.timed, error: calendar.error },
    allDay: { ok: !calendar.error, items: calendar.allDay, error: calendar.error },
    tasks: { ok: !tasks.error, items: tasks.items, error: tasks.error },
    mail: { ok: !mail.error, items: mail.items, error: mail.error },
  }
}

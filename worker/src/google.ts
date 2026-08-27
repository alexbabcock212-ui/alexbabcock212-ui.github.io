/**
 * Google, as far as this Worker is concerned.
 *
 * One refresh token in, two read-only feeds out. Every fetch is best-effort
 * and reports its own failure: a dead Tasks call must not blank the timetable,
 * so each source returns `{ ok: false, error }` instead of throwing.
 */
import type { Env } from './env'
import { message, settle } from './feed'
import type { Feed } from './feed'

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

/* ── the shapes the dashboard reads ────────────────────────────────────── */

export interface RawEvent {
  id: string
  title: string
  location: string
  /** The calendar it came from. Names a course when the calendar names one. */
  calendar: string
  /** ISO 8601. Timed events only — see the filter in `fetchCalendar`. */
  start: string
  end: string
}

export interface RawAllDay {
  id: string
  title: string
  calendar: string
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

export type { Feed }

export interface Payload {
  fetchedAt: number
  calendar: Feed<RawEvent>
  allDay: Feed<RawAllDay>
  tasks: Feed<RawTask>
}

/**
 * How far ahead the calendar fetch reaches.
 *
 * Wider than the two weeks the DUE screen shows, and deliberately so: this
 * window is also what discovers *which courses exist*. A term whose first
 * lecture is three weeks out would otherwise leave the Courses screen empty
 * right when a timetable is most worth looking at. Screens that mean "the next
 * fortnight" trim it themselves — see HORIZON_DAYS in src/data/sources/tasks.ts.
 */
export const HORIZON_DAYS = 35

/**
 * Cloudflare allows 50 subrequests per request on this plan, and one dashboard
 * read spends them fast: a token refresh, a calendar list, one per calendar,
 * and one per task list. Exceeding the limit does not degrade, it throws,
 * which is how moving from one calendar to eight turned a working Worker into
 * HTTP 500.
 *
 * Worst case with the caps below, plus the market brief's four:
 *   1 + 1 + MAX_CALENDARS + 1 + 3 + 4  =  22
 */
export const MAX_CALENDARS = 12

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

/* ── which calendars exist ─────────────────────────────────────────────── */

export interface CalendarRef {
  id: string
  summary: string
  primary: boolean
  /** Whether the user has this calendar ticked on in the Google UI. */
  selected: boolean
  /** Google's own holiday and birthday feeds — noise for a timetable. */
  generated: boolean
}

/** Every calendar on the account, annotated enough to decide what to read. */
export async function fetchCalendarList(token: string): Promise<CalendarRef[]> {
  const body = await api<{
    items?: {
      id: string
      summary?: string
      primary?: boolean
      selected?: boolean
      accessRole?: string
    }[]
  }>('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250', token)

  return (body.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary ?? c.id,
    primary: Boolean(c.primary),
    selected: c.selected !== false,
    generated:
      c.id.endsWith('#holiday@group.v.calendar.google.com') ||
      c.id.endsWith('#contacts@group.v.calendar.google.com') ||
      c.id.endsWith('#weeknum@group.v.calendar.google.com'),
  }))
}

/* ── calendar ──────────────────────────────────────────────────────────── */

interface ApiEvent {
  id: string
  summary?: string
  location?: string
  status?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

/** Ids are only unique within a calendar; the same event can appear in two. */
const uid = (calendarId: string, eventId: string) => `${calendarId}:${eventId}`

/**
 * Timed events and all-day entries from one calendar, kept apart.
 *
 * They answer different questions: a timed event belongs on the hour-by-hour
 * timeline, while an all-day entry is almost always a due date, so it belongs
 * on the DUE screen next to the tasks.
 */
async function fetchOneCalendar(
  token: string,
  now: Date,
  ref: CalendarRef,
): Promise<{ timed: RawEvent[]; allDay: RawAllDay[] }> {
  const params = new URLSearchParams({
    timeMin: startOfDay(now).toISOString(),
    timeMax: addDays(startOfDay(now), HORIZON_DAYS).toISOString(),
    // Expand recurring events into individual occurrences.
    singleEvents: 'true',
    orderBy: 'startTime',
    // Room for a full term's worth of recurring classes in the wider window.
    maxResults: '750',
  })

  const body = await api<{ items?: ApiEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ref.id)}/events?${params}`,
    token,
  )

  const live = (body.items ?? []).filter((e) => e.status !== 'cancelled')

  return {
    timed: live
      .filter((e) => e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({
        id: uid(ref.id, e.id),
        title: e.summary?.trim() || '(no title)',
        location: e.location?.trim() ?? '',
        start: e.start!.dateTime!,
        end: e.end!.dateTime!,
        calendar: ref.summary,
      })),
    allDay: live
      .filter((e) => e.start?.date && !e.start.dateTime)
      .map((e) => ({
        id: uid(ref.id, e.id),
        title: e.summary?.trim() || '(no title)',
        date: e.start!.date!,
        calendar: ref.summary,
      })),
  }
}

/** Names the user does not want on the dashboard, from `CALENDAR_EXCLUDE`. */
const excluded = (env: Env) =>
  new Set(
    env.CALENDAR_EXCLUDE?.split(',')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean) ?? [],
  )

/**
 * Every calendar worth reading, merged.
 *
 * Reading only `primary` was the original design and it was wrong for how this
 * account is organised: each course has its own calendar, so `primary` held
 * nothing but personal appointments and the Courses screen was permanently
 * empty. Since a course calendar is *named* for its course, the calendar is now
 * also the most reliable way to know which course an event belongs to — far
 * better than reading the event's title and hoping.
 *
 * A denylist rather than an allowlist, so adding a sixth course next term needs
 * no configuration at all.
 */
export async function fetchCalendar(
  token: string,
  now: Date,
  env: Env,
): Promise<{ timed: RawEvent[]; allDay: RawAllDay[] }> {
  const skip = excluded(env)
  const all = await fetchCalendarList(token)
  const wanted = all
    .filter((c) => !c.generated && !skip.has(c.summary.trim().toLowerCase()))
    // Primary first, so that if the cap ever bites it is the least important
    // calendars that get dropped rather than an arbitrary set.
    .sort((a, b) => Number(b.primary) - Number(a.primary))
    .slice(0, MAX_CALENDARS)

  const results = await pooled(wanted, 5, async (ref) => {
    try {
      return await fetchOneCalendar(token, now, ref)
    } catch {
      // One unreadable calendar must not cost the other seven — a shared
      // calendar losing access should not empty the timetable.
      return { timed: [] as RawEvent[], allDay: [] as RawAllDay[] }
    }
  })

  const timed = results.flatMap((r) => r.timed).sort((a, b) => a.start.localeCompare(b.start))
  const allDay = results.flatMap((r) => r.allDay).sort((a, b) => a.date.localeCompare(b.date))

  return { timed, allDay }
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

/* ── everything at once ────────────────────────────────────────────────── */

/**
 * Both Google feeds in parallel, each allowed to fail on its own.
 *
 * A token failure is the exception: nothing can succeed without one, so it is
 * reported identically on every feed rather than twice over.
 */
export async function fetchAll(env: Env, now = new Date()): Promise<Payload> {
  let token: string
  try {
    token = await accessToken(env)
  } catch (e) {
    const dead = { ok: false, items: [], error: message(e) }
    return { fetchedAt: Date.now(), calendar: dead, allDay: dead, tasks: dead }
  }

  const [calendar, tasks] = await Promise.all([
    fetchCalendar(token, now, env).then(
      (r) => ({ timed: r.timed, allDay: r.allDay, error: undefined as string | undefined }),
      (e) => ({ timed: [] as RawEvent[], allDay: [] as RawAllDay[], error: message(e) }),
    ),
    settle(fetchTasks(token)),
  ])

  return {
    fetchedAt: Date.now(),
    calendar: { ok: !calendar.error, items: calendar.timed, error: calendar.error },
    allDay: { ok: !calendar.error, items: calendar.allDay, error: calendar.error },
    tasks,
  }
}

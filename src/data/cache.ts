/**
 * The last read, kept on the device.
 *
 * This is what makes the app open instantly and work on the subway. The fetch
 * covers a fortnight of events and a timetable recurs, so yesterday's payload
 * still answers "what are my classes on Thursday?" correctly — the screen fills
 * from here on launch, and the network read that follows just corrects it.
 */
import type { Feed, Payload } from './payload'

const KEY = 'life-dashboard:payload'

/** Past this the cached window no longer reaches today. */
const WINDOW_DAYS = 14

/**
 * Every feed this build reads.
 *
 * A cache written by an older build is missing whichever feeds that build did
 * not know about — a fortnight of them can outlive a deploy — and the shaping
 * code reads `.ok` off each one by name. Half-rendering such a payload is a
 * blank screen on the first launch after every schema change, which is exactly
 * what removing the mail feed and adding the market ones caused. So a payload
 * that is not this build's shape is discarded and refetched, not repaired.
 */
const FEEDS = ['calendar', 'allDay', 'tasks', 'quotes', 'headlines'] as const

const isCurrentShape = (payload: Payload) =>
  FEEDS.every((name) => {
    const feed: Feed<unknown> | undefined = payload[name]
    return feed != null && Array.isArray(feed.items)
  })

export function loadCachedPayload(now = Date.now()): Payload | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return null

    const payload = JSON.parse(raw) as Payload
    if (!payload?.fetchedAt || !isCurrentShape(payload)) return null
    if (now - payload.fetchedAt > WINDOW_DAYS * 86_400_000) return null

    return payload
  } catch {
    return null
  }
}

export function saveCachedPayload(payload: Payload): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(payload))
  } catch {
    // Quota or private mode — the app just refetches next time.
  }
}

export function clearCachedPayload(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Nothing to do.
  }
}

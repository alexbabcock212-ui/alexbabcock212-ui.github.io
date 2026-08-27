/**
 * The wire format between the Worker and this app.
 *
 * Kept deliberately close to what the upstream services return: the Worker's
 * job is to hold the refresh token and reach the hosts a browser cannot, so
 * all interpretation happens here, on the device, where it can be changed
 * without a redeploy of the back end.
 *
 * These declarations mirror `worker/src/google.ts` and `worker/src/markets.ts`.
 * Two copies is the cost of the two halves shipping separately; keep them in
 * step.
 */

export interface RawEvent {
  id: string
  title: string
  location: string
  /** The calendar it came from. Names a course when the calendar names one. */
  calendar: string
  /** ISO 8601 with an offset. Timed events only. */
  start: string
  end: string
}

export interface RawAllDay {
  id: string
  title: string
  calendar: string
  /** `YYYY-MM-DD` — a calendar date, with no time and no zone. */
  date: string
}

export interface RawTask {
  id: string
  title: string
  notes: string
  /** RFC 3339. Google Tasks only stores the date part; the time is always 00:00Z. */
  due: string | null
  list: string
}

export interface RawQuote {
  /** The ticker the board is keyed off, e.g. `^GSPC`. */
  symbol: string
  price: number
  /** The previous session's close — what the day's change is measured from. */
  previousClose: number
  /** The session so far, downsampled. Empty when there is nothing to draw. */
  spark: number[]
  /** Last print, epoch ms. */
  at: number
}

export interface RawHeadline {
  id: string
  title: string
  source: string
  url: string
  /** Published, epoch ms. */
  at: number
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
  quotes: Feed<RawQuote>
  headlines: Feed<RawHeadline>
}

export const emptyFeed = <T,>(): Feed<T> => ({ ok: false, items: [] })

export const emptyPayload = (): Payload => ({
  fetchedAt: 0,
  calendar: emptyFeed(),
  allDay: emptyFeed(),
  tasks: emptyFeed(),
  quotes: emptyFeed(),
  headlines: emptyFeed(),
})

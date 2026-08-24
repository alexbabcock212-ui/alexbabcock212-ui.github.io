/**
 * The wire format between the Worker and this app.
 *
 * Kept deliberately close to what Google returns: the Worker's job is to hold
 * the refresh token and nothing more, so all interpretation happens here, on
 * the device, where it can be changed without a redeploy of the back end.
 *
 * These declarations mirror `worker/src/google.ts`. Two copies is the cost of
 * the two halves shipping separately; keep them in step.
 */

export interface RawEvent {
  id: string
  title: string
  location: string
  /** ISO 8601 with an offset. Timed events only. */
  start: string
  end: string
}

export interface RawAllDay {
  id: string
  title: string
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

export interface RawMessage {
  id: string
  threadId: string
  from: string
  address: string
  subject: string
  snippet: string
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

export const emptyFeed = <T,>(): Feed<T> => ({ ok: false, items: [] })

export const emptyPayload = (): Payload => ({
  fetchedAt: 0,
  calendar: emptyFeed(),
  allDay: emptyFeed(),
  tasks: emptyFeed(),
  mail: emptyFeed(),
})

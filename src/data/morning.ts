/**
 * The 6:45 rule.
 *
 * The brief is meant to be right when it is read in the morning, which is a
 * different promise from "fetched at 6:45 exactly". Two mechanisms cover it:
 *
 *   1. If the app is open or merely backgrounded at 6:45, a timer fires and it
 *      refetches on the spot.
 *   2. Whichever way you arrive at it later — cold launch, tab switch, pulling
 *      it out of the app switcher — anything read *before* today's 6:45 counts
 *      as stale and is refetched before you see it.
 *
 * Worth being straight about the limit: iOS gives a home-screen web app no way
 * to wake itself while it is closed. Safari supports neither Periodic
 * Background Sync nor background fetch. So nothing runs at 6:45 on a locked
 * phone; what (2) guarantees is that the first look of the day is never
 * yesterday's data.
 */

export const MORNING_HOUR = 6
export const MORNING_MINUTE = 45

/** The most recent 6:45 at or before `now`. */
export function lastMorning(now: Date = new Date()): Date {
  const boundary = new Date(now)
  boundary.setHours(MORNING_HOUR, MORNING_MINUTE, 0, 0)
  if (boundary > now) boundary.setDate(boundary.getDate() - 1)
  return boundary
}

/** The next 6:45 strictly after `now`. */
export function nextMorning(now: Date = new Date()): Date {
  const boundary = new Date(now)
  boundary.setHours(MORNING_HOUR, MORNING_MINUTE, 0, 0)
  if (boundary <= now) boundary.setDate(boundary.getDate() + 1)
  return boundary
}

/** How long a read stays good during the day, before reopening refetches. */
export const SOFT_TTL_MS = 10 * 60 * 1000

/**
 * Whether `fetchedAt` needs replacing.
 *
 * Stale either because the day has turned over past 6:45 since it was read, or
 * because it is simply old enough that a glance deserves better.
 */
export function isStale(fetchedAt: number | null, now: Date = new Date()): boolean {
  if (fetchedAt === null) return true
  if (fetchedAt < lastMorning(now).getTime()) return true
  return now.getTime() - fetchedAt > SOFT_TTL_MS
}

/**
 * Run `onMorning` at the next 6:45, then every 6:45 after.
 *
 * `setTimeout` is capped at about 24.9 days and throttled hard in background
 * tabs, so the delay is re-derived from the clock on each firing rather than
 * accumulated — a suspended timer that fires late still lands on the right day.
 */
export function scheduleMorning(onMorning: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = () => {
    const delay = Math.max(1000, nextMorning().getTime() - Date.now())
    timer = setTimeout(() => {
      onMorning()
      arm()
    }, delay)
  }

  arm()
  return () => clearTimeout(timer)
}

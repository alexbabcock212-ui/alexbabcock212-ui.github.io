/**
 * The parts of the brief the clock alone can answer.
 *
 * Everything else now comes from the Worker (`./useDashboard`) or the Desktop
 * scan (`./courses`); nothing here is authored data.
 */

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** e.g. `SUN 23 AUG` — the real date, in the design's kicker style. */
export function dateKicker(now: Date = new Date()): string {
  return `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`
}

/** `Morning` / `Afternoon` / `Evening`, to open the brief with. */
export function salutation(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

/** e.g. `read at 8:14 AM`, `read yesterday`, `read 3 days ago`. */
export function freshness(fetchedAt: number, now: Date = new Date()): string {
  const then = new Date(fetchedAt)
  const days = Math.floor((now.getTime() - fetchedAt) / 86_400_000)
  if (now.toDateString() === then.toDateString()) return `read at ${clock(then)}`
  if (days <= 1) return 'read yesterday'
  return `read ${days} days ago`
}

/** e.g. `6:02 AM`, for the simulated status bar in the desktop bezel. */
export function clock(now: Date = new Date()): string {
  return (
    now
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      // Node and some browsers emit a narrow no-break space before AM/PM.
      .replace(/[\u202f\u00a0]/g, ' ')
  )
}

/** e.g. `24 Aug` — for dating the Desktop scan, which is not a live read. */
export function shortDate(at: number): string {
  const d = new Date(at)
  const month = MONTHS[d.getMonth()]
  return `${d.getDate()} ${month[0]}${month.slice(1).toLowerCase()}`
}

/**
 * The dashboard's data.
 *
 * Nothing here is invented. Every source reports `not-connected` and every
 * collection is empty, because none of them are wired yet — the screens render
 * honest empty states rather than content that could be mistaken for the
 * user's own. The only values below are ones genuinely derivable right now,
 * from the clock.
 *
 * Connecting a source means setting its state to `ready` and filling its
 * collections with the shapes in `./types`. No view changes.
 */
import type { Dashboard } from './types'

export const dashboard: Dashboard = {
  calendar: 'not-connected',
  tasks: 'not-connected',
  mail: 'not-connected',
  money: 'not-connected',

  allocation: [],
  schedule: [],
  lede: null,
  chips: [],

  deadlines: [],
  clusters: [],
  courses: [],

  netWorth: null,
  moneyStats: [],
  positions: [],
  outflows: [],
}

/* ── the parts the clock alone can answer ──────────────────────────────── */

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

/** e.g. `6:02 AM`, for the simulated status bar in the desktop bezel. */
export function clock(now: Date = new Date()): string {
  return (
    now
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      // Node and some browsers emit a narrow no-break space before AM/PM.
      .replace(/[\u202f\u00a0]/g, ' ')
  )
}

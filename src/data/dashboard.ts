/**
 * Fixture content for the dashboard.
 *
 * Every screen reads from here, so wiring the real sources — Gmail, Calendar,
 * Tasks, Canvas, the brokerage — means replacing these exports with fetches
 * that return the same shapes. Nothing below is referenced by the views except
 * through `src/data/types.ts`.
 */
import type {
  AllocSegment,
  Brief,
  Cluster,
  Course,
  Deadline,
  NetWorth,
  Outflow,
  Position,
  Slot,
  Stat,
} from './types'

export const statusBar = { time: '6:02 AM', indicators: ['WIFI', '84%'] }

/* ── today ─────────────────────────────────────────────────────────────── */

export const brief: Brief = {
  kicker: 'SUN 23 AUG · BRIEF NO. 148',
  salutation: 'Morning',
  focus: 'Today is yours until 9:30.',
  lede: "Two lectures, one belay partner, market's up. Rain lands at 4 — the gym session at 6 is safe.",
  chips: [
    { label: '6H FREE', tone: 'solid' },
    { label: 'PORTFOLIO +1.4%', tone: 'outline' },
    { label: '2 DUE ≤ 5D', tone: 'outline' },
  ],
  rebuiltAt: '6 AM',
  rebuiltNote:
    "Rebuilt every morning at 6:00. Tomorrow's lighter — if you want a real rest day, that's the one.",
}

export const allocation: AllocSegment[] = [
  { label: 'CLASS', hours: 3.5, color: 'var(--color-accent-900)' },
  { label: 'DEEP WORK', hours: 4, color: 'var(--color-accent)' },
  { label: 'CLIMB', hours: 2.5, color: 'var(--color-accent-400)' },
  { label: 'PEOPLE', hours: 2, color: 'var(--color-accent-200)' },
  { label: 'UNCLAIMED', hours: 4, color: null },
]

export const schedule: Slot[] = [
  {
    kind: 'plain',
    time: '7:00',
    title: 'Coffee + brief',
    note: 'Pulled from Gmail, Calendar, Tasks, Canvas, brokerage · 6:00 AM',
  },
  {
    kind: 'plain',
    time: '8:30',
    title: 'Hangboard, 20 min',
    note: 'Day 3 of the cycle. Short and honest.',
  },
  {
    kind: 'feature',
    time: '9:30',
    where: 'CS 3600 · KLAUS 1443',
    seq: 'LEC 12/28',
    title: 'Bayesian networks: independence & d-separation',
    facts: [
      { label: 'BEFORE', text: "AIMA 13.1–13.4 (22 pp.) — you're 8 in" },
      { label: 'DUE', text: "PS4 Fri — Q1–Q3 are today's material" },
      { label: 'WHY CARE', text: 'This is the machinery behind the risk models you were reading about' },
    ],
  },
  {
    kind: 'plain',
    time: '12:30',
    title: 'Lunch with Priya',
    note: 'She moved it 30 min later. Klaus courtyard.',
  },
  {
    kind: 'minor',
    time: '2:00',
    where: 'MATH 3215 · SKILES 202',
    seq: 'LEC 9/26',
    title: 'Joint distributions & marginals',
    note: 'No prep. Bring PS5 — first 20 min is a walkthrough.',
  },
  {
    kind: 'plain',
    time: '4:00',
    title: 'Rain starts · market closes',
    note: 'VTI +0.8%, your two positions both green',
  },
  {
    kind: 'highlight',
    time: '6:00',
    kicker: 'STONE SUMMIT · WITH DEV',
    title: 'Project night — Sunset Arête, V6',
    note: 'Attempt 7. Last time you stuck the crux and blew the top-out.',
  },
]

/* ── due ───────────────────────────────────────────────────────────────── */

export const deadlines: Deadline[] = [
  {
    id: 'ps4',
    course: 'CS 3600',
    title: 'Problem Set 4',
    note: "Q1–Q3 come from today's lecture",
    when: 'FRI\n11:59 PM',
    urgent: true,
  },
  {
    id: 'quiz4',
    course: 'ECON 2106',
    title: 'Quiz 4 — elasticity',
    note: 'In recitation, 20 min',
    when: 'TUE\n1:00 PM',
    urgent: true,
  },
  {
    id: 'hist',
    course: 'HIST 2111',
    title: 'Reading quiz — ch. 6',
    note: '28 pp. — start tonight',
    when: 'TUE\n3:30 PM',
    urgent: false,
  },
  {
    id: 'ps5',
    course: 'MATH 3215',
    title: 'Problem Set 5',
    note: "Today's walkthrough covers half of it",
    when: 'MON\n11:59 PM',
    urgent: false,
  },
  {
    id: 'advise',
    course: 'ADVISING',
    title: 'Confirm spring registration slot',
    note: 'Email from Dr. Okonkwo',
    when: 'SEP 2',
    urgent: false,
  },
  {
    id: 'housing',
    course: 'HOUSING',
    title: 'Sign renewal addendum',
    note: 'Rate locks after this',
    when: 'SEP 5',
    urgent: false,
  },
]

export const deadlinesNote =
  'Nothing else lands before Sep 2. Clear PS4 before Thursday and the week ends genuinely free.'

/* ── inbox ─────────────────────────────────────────────────────────────── */

export const inboxHeader = {
  kicker: '48 NEW · GROUPED FOR YOU',
  title: 'Mail, summarized',
  sub: 'Three clusters want a reply. Thirty went to the weekly sweep.',
}

export const clusters: Cluster[] = [
  {
    id: 'advising',
    name: 'Advising & registration',
    count: '4 MSGS',
    summary:
      'Dr. Okonkwo needs your spring slot confirmed by Sep 2. Two reminders and a holds-cleared notice underneath it.',
    tag: 'REPLY TODAY',
    live: true,
  },
  {
    id: 'ta-hours',
    name: 'TA hours swap',
    count: '3 MSGS',
    summary:
      'Marcus wants to trade Thursday 4 PM for your Friday 2 PM. Everyone else already agreed.',
    tag: 'REPLY TODAY',
    live: true,
  },
  {
    id: 'housing',
    name: 'Housing renewal',
    count: '2 MSGS',
    summary: 'Addendum ready to sign; the quoted rate holds through Sep 5.',
    tag: 'REPLY THIS WEEK',
    live: true,
  },
  {
    id: 'announcements',
    name: 'Course announcements',
    count: '9 MSGS',
    summary:
      'PS4 clarification thread on Bayes nets, one room change for MATH recitation. Nothing needs an answer.',
    tag: 'READ ONLY',
    live: false,
  },
  {
    id: 'swept',
    name: 'Clubs, newsletters, promos',
    count: '30 MSGS',
    summary:
      'Swept to the weekly digest. Robotics club officer applications close Friday if you care.',
    tag: 'SWEPT',
    live: false,
  },
]

/* ── courses ───────────────────────────────────────────────────────────── */

export const termHeader = {
  kicker: 'FALL 2026 · 13 CREDITS',
  title: 'Course load',
  sub: 'Four courses. Every lecture carries its own prep.',
}

export const courses: Course[] = [
  {
    code: 'CS 3600',
    name: 'Introduction to Artificial Intelligence',
    meets: 'MW 9:30',
    progress: 0.43,
    today: true,
    facts: [
      { label: 'TODAY', text: 'L12 — Bayesian networks, d-separation' },
      { label: 'READ', text: 'AIMA 13.1–13.4' },
      { label: 'NEXT', text: 'Wed — exact inference by enumeration' },
    ],
  },
  {
    code: 'MATH 3215',
    name: 'Probability & Statistics',
    meets: 'MWF 2:00',
    progress: 0.35,
    today: false,
    facts: [
      { label: 'TODAY', text: 'L9 — Joint distributions & marginals' },
      { label: 'READ', text: 'None assigned' },
      { label: 'NEXT', text: 'Wed — covariance & correlation' },
    ],
  },
  {
    code: 'ECON 2106',
    name: 'Principles of Microeconomics',
    meets: 'TR 12:30',
    progress: 0.29,
    today: false,
    facts: [
      { label: 'NEXT', text: 'L8 — Elasticity of demand' },
      { label: 'READ', text: 'Mankiw ch. 5' },
      { label: 'USE', text: 'Same elasticity math as your dividend notes' },
    ],
  },
  {
    code: 'HIST 2111',
    name: 'United States to 1877',
    meets: 'TR 3:30',
    progress: 0.31,
    today: false,
    facts: [
      { label: 'NEXT', text: 'L7 — Reconstruction politics' },
      { label: 'READ', text: 'Ch. 6 — 28 pp., quiz Tue' },
    ],
  },
]

/* ── money ─────────────────────────────────────────────────────────────── */

export const netWorth: NetWorth = {
  kicker: 'NET WORTH · AUG 23',
  value: '$28,410',
  delta: '+$392 this week · +$4,180 this year',
}

export const moneyStats: Stat[] = [
  { label: 'SAVED / MO', value: '$610' },
  { label: 'SAVE RATE', value: '31%', lead: true },
  { label: 'RUNWAY', value: '7 mo' },
]

export const positions: Position[] = [
  { symbol: 'VTI', desc: 'total market', value: '$14,220', change: '+1.4%', changeTone: 'up' },
  { symbol: 'VXUS', desc: 'ex-US', value: '$4,860', change: '+0.6%', changeTone: 'up' },
  { symbol: 'Roth IRA', desc: 'target 2065', value: '$6,900', change: '−0.2%', changeTone: 'quiet' },
  { symbol: 'Cash', desc: 'HYSA 4.1%', value: '$2,430', change: '+$8', changeTone: 'quiet' },
]

export const outflows: Outflow[] = [
  { label: 'Rent — Peachtree Walk', amount: '$780 · Sep 1' },
  { label: 'Gym membership', amount: '$89 · Aug 30' },
  { label: 'Auto-invest → VTI', amount: '$400 · Sep 1' },
]

export const moneyCallout =
  'Groceries are $28 under your usual week. Hold it through Friday and the Sep 1 auto-invest goes in without touching cash.'

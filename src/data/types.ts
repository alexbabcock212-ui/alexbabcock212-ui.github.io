/** Every screen the tab bar can reach. */
export type TabId = 'today' | 'courses' | 'due' | 'inbox' | 'money'

/**
 * How a screen's underlying source is doing.
 *
 * Nothing here is wired to a live source yet, so everything reports
 * `not-connected`. Views must render honestly in that state rather than
 * showing content the user could mistake for their own.
 */
export type SourceState = 'not-connected' | 'loading' | 'ready' | 'error'

/* ── today ─────────────────────────────────────────────────────────────── */

export interface Chip {
  label: string
  /** `solid` is the day's headline number; `outline` is supporting. */
  tone: 'solid' | 'outline'
}

export interface AllocSegment {
  label: string
  hours: number
  /** A CSS colour for the bar; `null` renders as unclaimed (outlined) time. */
  color: string | null
}

interface SlotBase {
  time: string
}

/** A line item — no card, no emphasis. */
export interface PlainSlot extends SlotBase {
  kind: 'plain'
  title: string
  note: string
}

/** The one block the day is built around. */
export interface FeatureSlot extends SlotBase {
  kind: 'feature'
  where: string
  seq: string
  title: string
  facts: { label: string; text: string }[]
}

/** A second commitment that needs a card but not the spotlight. */
export interface MinorSlot extends SlotBase {
  kind: 'minor'
  where: string
  seq: string
  title: string
  note: string
}

/** The block the user is looking forward to. */
export interface HighlightSlot extends SlotBase {
  kind: 'highlight'
  kicker: string
  title: string
  note: string
}

export type Slot = PlainSlot | FeatureSlot | MinorSlot | HighlightSlot

/* ── due ───────────────────────────────────────────────────────────────── */

export interface Deadline {
  id: string
  course: string
  title: string
  note: string
  /** May contain a newline — rendered with `white-space: pre-line`. */
  when: string
  urgent: boolean
}

/* ── inbox ─────────────────────────────────────────────────────────────── */

export interface Cluster {
  id: string
  name: string
  count: string
  summary: string
  tag: string
  /** Wants a reply — gets the accent edge and the filled tag. */
  live: boolean
}

/* ── courses ───────────────────────────────────────────────────────────── */

export interface Course {
  code: string
  name: string
  meets: string
  /** Fraction of the term's lectures delivered, 0–1. */
  progress: number
  /** Meets today — takes the emphasised card. */
  today: boolean
  facts: { label: string; text: string }[]
}

/* ── money ─────────────────────────────────────────────────────────────── */

export interface Stat {
  label: string
  value: string
  /** The number worth reading first. */
  lead?: boolean
}

export interface Position {
  symbol: string
  desc: string
  value: string
  change: string
  /** `up` gets the filled badge, `quiet` the outlined one. */
  changeTone: 'up' | 'quiet'
}

export interface Outflow {
  label: string
  amount: string
}

export interface NetWorth {
  kicker: string
  value: string
  delta: string
}

/* ── the whole board ───────────────────────────────────────────────────── */

/** Everything the five screens read, plus the health of each source. */
export interface Dashboard {
  calendar: SourceState
  tasks: SourceState
  mail: SourceState
  money: SourceState

  /** Today, from the calendar. */
  allocation: AllocSegment[]
  schedule: Slot[]
  /** A one-line read on the day, written only when there is a day to read. */
  lede: string | null
  /** Headline figures for the day — free hours and the like. Derived, never
   *  authored, so they stay empty until a source can compute them. */
  chips: Chip[]

  deadlines: Deadline[]
  clusters: Cluster[]
  courses: Course[]

  netWorth: NetWorth | null
  moneyStats: Stat[]
  positions: Position[]
  outflows: Outflow[]
}

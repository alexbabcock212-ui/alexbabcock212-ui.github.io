/** Every screen the tab bar can reach. */
export type TabId = 'today' | 'courses' | 'due' | 'markets' | 'groceries'

/**
 * How a screen's underlying source is doing.
 *
 * `not-connected` means this device has no API key yet; `error` means the key
 * is fine but the read failed. Views must render honestly in both rather than
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
  /** Stable across renders — two events can start at the same minute. */
  id: string
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
  /** Lecture number etc. Blank until a syllabus supplies it. */
  seq: string
  title: string
  /** Readings and the rest — empty until a syllabus supplies them. */
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
  /** Course code where one could be read off the title, else the list name. */
  course: string
  title: string
  note: string
  /** May contain a newline — rendered with `white-space: pre-line`. */
  when: string
  urgent: boolean
  /** Sort key, epoch ms. `null` sorts last: undated tasks have no deadline. */
  at: number | null
}

/* ── markets ───────────────────────────────────────────────────────────── */

/** Which way a row moved. `flat` is an exact match, not a rounding. */
export type Direction = 'up' | 'down' | 'flat'

/** One line of the board, formatted for reading rather than for arithmetic. */
export interface Quote {
  symbol: string
  label: string
  /** What the row is, in two or three words — `Toronto`, `Treasury yield`. */
  sub: string
  /** The level: `7,730.99`, `4.67%`, `1.3852`. */
  value: string
  /** Signed and in the row's own unit: `+55.29`, `+0.8 bp`. */
  change: string
  /** Signed percent. Empty on a yield, where a percent of a percent misleads. */
  percent: string
  direction: Direction
  /** The session's path, normalised 0–1. Empty when there is too little to draw. */
  spark: number[]
  /** When the row last printed, e.g. `4:00 PM`. */
  time: string
}

/** A band of the board — North America, rates, commodities, overseas. */
export interface QuoteGroup {
  title: string
  /** Breadth, counted from the rows themselves: `4 UP · 1 DOWN`. */
  meta: string
  quotes: Quote[]
}

export interface Headline {
  id: string
  title: string
  source: string
  url: string
  /** How old, e.g. `2H AGO`. */
  when: string
}

/** Everything the MARKETS screen reads. */
export interface Markets {
  /** The row the screen leads with, when the board has one. */
  lead: Quote | null
  groups: QuoteGroup[]
  headlines: Headline[]
  /** A factual read on the session. Derived from the rows, never authored. */
  brief: string | null
}

/* ── courses ───────────────────────────────────────────────────────────── */

/** What a file in a course folder is, as far as its extension can say. */
export type MaterialKind = 'pdf' | 'slides' | 'doc' | 'sheet' | 'data' | 'other'

/** One file inside a course folder on the Desktop. */
export interface Material {
  name: string
  /** The subfolder it sits in — `Week 3`, `Course Info` — or `''` at the root. */
  section: string
  kind: MaterialKind
  /** Last modified, epoch ms. */
  modified: number
}

/**
 * One lecture deck, as its own slides describe it.
 *
 * Every field is read off the file. Nothing here is written by the app: a deck
 * with nothing to say produces an empty `topics`, never a plausible-sounding
 * one.
 */
export interface DeckOutline {
  /** The file it came from, so a topic can be traced back to a slide. */
  file: string
  /** The lecture's own heading — `Historical Background I: Greece 480-404 BC`. */
  title: string
  /** `Lecture 3` off the title slide. Null when the deck does not number itself. */
  number: number | null
  slides: number
  /** What it covers, in the deck's own words and its own order. */
  topics: string[]
  /**
   * Which reading produced `topics`.
   *
   * `summary` — the deck's own "Main Points" or objectives slide, verbatim.
   * `sections` — the heading off each slide, which is its table of contents.
   */
  source: 'summary' | 'sections'
}

/** One week of a course, assembled from the syllabus and that week's slides. */
export interface Lecture {
  /** 1-based week of term. */
  week: number
  topic: string
  /** The dates the syllabus lists, verbatim — `Sep 17 and 19`. */
  dates: string
  /** Chapters or readings, verbatim — `3`, `1-4, 9`. */
  readings: string
  /**
   * What the lecture covers, in more than a title's worth of words.
   *
   * Every word comes from the user's own files: an objectives slide where the
   * deck has one, the deck's title line where it does not, or whatever they
   * typed into lectures.tsv. Never generated.
   */
  detail: string
  detailSource: 'file' | 'slides' | 'none'
  /** Every deck that week's folder holds, in lecture order. */
  decks: DeckOutline[]
}

/** A dated row in the syllabus that is not a lecture. */
export interface Assessment {
  label: string
  /** Verbatim from the syllabus — `Oct 06`, `Oct 14 to Oct 18`. */
  dates: string
}

/** Where a course's lecture topics came from — the screen says so. */
export type LecturesSource = 'file' | 'pdf' | 'none'

/**
 * A course folder as `scripts/scan-courses.ts` found it on the Desktop.
 *
 * Baked into the bundle at deploy time: a web page cannot read a filesystem,
 * so this is a snapshot taken on the Mac, not a live view.
 */
export interface CourseFolder {
  code: string
  /** Folder name as it appears on disk, which may differ in case or spacing. */
  folder: string
  /** Subfolder names, in the order they should be shown. */
  sections: string[]
  materials: Material[]
  fileCount: number
  /** Newest material's mtime, epoch ms; `null` when the folder is empty. */
  updated: number | null
  /** Week-by-week topics, from lectures.tsv or a parsed syllabus. */
  lectures: Lecture[]
  lecturesSource: LecturesSource
  /** Midterms, finals and reading weeks, from the syllabus table. */
  assessments: Assessment[]
}

export interface Course {
  code: string
  /** The room, from the calendar — the only name the calendar can supply. */
  name: string
  meets: string
  /** Fraction of the term's lectures delivered, 0–1. Zero when unknowable. */
  progress: number
  /** Meets today — takes the emphasised card. */
  today: boolean
  facts: { label: string; text: string }[]
  /** Desktop materials, when a folder matched this code. */
  folder: CourseFolder | null
  /** The term's topics, week by week. Empty when no syllabus has been read. */
  lectures: Lecture[]
  assessments: Assessment[]
  /** Which week of term it is, or null outside the term. */
  currentWeek: number | null
}

/* ── the whole board ───────────────────────────────────────────────────── */

/** Everything the four screens read, plus the health of each source. */
export interface Dashboard {
  calendar: SourceState
  tasks: SourceState
  quotes: SourceState
  news: SourceState

  /** Today, from the calendar. */
  allocation: AllocSegment[]
  schedule: Slot[]
  /** A one-line read on the day, written only when there is a day to read. */
  lede: string | null
  /** Headline figures for the day — free hours and the like. Derived, never
   *  authored, so they stay empty until a source can compute them. */
  chips: Chip[]

  deadlines: Deadline[]
  courses: Course[]
  markets: Markets

  /** When the sources were last read, epoch ms. Null if never. */
  fetchedAt: number | null
}

/* ── groceries ─────────────────────────────────────────────────────────── */

/**
 * What a line of a receipt is, coarsely enough that a default lifespan can be
 * attached to it. Eleven buckets, because a twelfth would mostly be a matter of
 * taste and every one of them has to mean something to the reader.
 */
export type GroceryCategory =
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'bakery'
  | 'frozen'
  | 'pantry'
  | 'beverages'
  | 'snacks'
  | 'household'
  | 'personal'
  | 'other'

/**
 * One line of a receipt, exactly as it was read.
 *
 * Nothing here is ever rewritten. A correction is stored beside it (see
 * `PantryEdits`) so that what the photo said and what you say it said stay
 * separable — which is the only way a bad read can be spotted later.
 */
export interface ReceiptLine {
  /** Stable across scans: the receipt's id and this line's position in it. */
  id: string
  item: string
  category: GroceryCategory
  qty: number
  /** Total paid for the line after any line discount, in dollars. */
  price: number
  /** Weeks the reader judged this would last. Null when it would not judge. */
  estimate: number | null
}

/** One shop, as read off one photo. */
export interface Receipt {
  id: string
  store: string
  /** Purchase date, `YYYY-MM-DD`, off the receipt rather than off the file. */
  date: string
  /** The printed total. Kept only so a misread line can be caught against it. */
  total: number | null
  /** The photo's filename, now under `Receipts/Filed/`. */
  photo: string
  /** `pending` until you have checked it; nothing pending counts toward a week. */
  status: 'pending' | 'kept'
  lines: ReceiptLine[]
}

/**
 * Who decided how long something lasts.
 *
 * The screen prints this, because the difference between a number you set and a
 * number a category default guessed is the difference between a figure you can
 * act on and one you should correct.
 */
export type LifespanSource = 'you' | 'pace' | 'receipt' | 'category'

/** A line once corrections, lifespans and dates have been applied to it. */
export interface PantryLine {
  id: string
  receipt: string
  store: string
  date: string
  /** Local midnight of `date`, epoch ms. */
  at: number
  item: string
  /** Normalised for matching the same thing bought again — `toilet paper`. */
  key: string
  category: GroceryCategory
  qty: number
  price: number
  /** How many weeks this purchase covers. */
  weeks: number
  weeksSource: LifespanSource
  /** `price / weeks` — what this purchase adds to every week it covers. */
  perWeek: number
}

/** One week of the trend, oldest first. */
export interface GroceryWeek {
  /** Local Monday 00:00, epoch ms. */
  start: number
  /** `SEP 1`. */
  label: string
  /** What the week costs with every purchase spread over how long it lasts. */
  spread: number
  /** What actually left the account that week. */
  cash: number
  current: boolean
}

/** One thing you buy, across every time you have bought it. */
export interface GroceryItem {
  key: string
  /** The most recent spelling of it. */
  item: string
  category: GroceryCategory
  /** What keeping it in stock costs per week: last price over its lifespan. */
  perWeek: number
  weeks: number
  weeksSource: LifespanSource
  /** How many separate shops it has appeared on. */
  buys: number
  lastAt: number
  lastPrice: number
  /** Its share of the weekly run rate, 0–1. */
  share: number
}

/** Something the last purchase of which is about to run out. */
export interface Restock {
  key: string
  item: string
  category: GroceryCategory
  /** When the last purchase runs out, epoch ms. */
  dueAt: number
  /** Days from now. Negative means you are already out. */
  days: number
  lastPrice: number
  weeks: number
  weeksSource: LifespanSource
}

/** A regular purchase whose unit price moved enough to be worth knowing. */
export interface PriceMove {
  key: string
  item: string
  /** Unit price this time and last time, in dollars. */
  now: number
  before: number
  /** Signed percent — `+12.4`. */
  percent: number
  direction: Direction
  /** When the new price was paid, epoch ms. */
  at: number
}

/** Everything the FOOD screen reads. */
export interface Groceries {
  /** Every kept line, newest first. */
  lines: PantryLine[]
  /** Receipts still waiting to be checked, newest first. */
  pending: Receipt[]
  /** What the pending receipts add up to, and so are keeping out of the number. */
  pendingTotal: number
  /** This week's run rate — the headline. */
  perWeek: number
  /** What actually left the account this week — the second number. */
  cash: number
  /** Twelve weeks, oldest first. */
  weeks: GroceryWeek[]
  /** The weekly figure being aimed at, in dollars. */
  target: number
  /** The median week, so the headline can be read against a normal one. */
  typical: number
  items: GroceryItem[]
  restock: Restock[]
  moves: PriceMove[]
  /** When the receipts file was last baked in, epoch ms. Null when never. */
  scannedAt: number | null
}

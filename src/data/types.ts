/** Every screen the tab bar can reach. */
export type TabId = 'today' | 'courses' | 'due' | 'inbox'

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
  mail: SourceState

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

  /** When the sources were last read, epoch ms. Null if never. */
  fetchedAt: number | null
}

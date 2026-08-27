import { useState } from 'react'
import EmptyState from '../components/EmptyState'
import { shortDate } from '../data/dashboard'
import { courseFolders, scanRedacted, scanRoot, scannedAt } from '../data/courses'
import { groupMaterials } from '../data/sources/courses'
import type { Course, Dashboard, Lecture, MaterialKind } from '../data/types'

/** Two or three letters is all the room there is beside a filename. */
const KIND_LABEL: Record<MaterialKind, string> = {
  pdf: 'PDF',
  slides: 'PPT',
  doc: 'DOC',
  sheet: 'XLS',
  data: 'CSV',
  other: '',
}

/** `Chapter 6 Lecture.pdf` → `Chapter 6 Lecture` — the extension is the chip. */
const stem = (name: string) => name.replace(/\.[^.]+$/, '')

/** What this course is covering right now, or null outside the term. */
const thisWeek = (c: Course) => c.lectures.find((l) => l.week === c.currentWeek) ?? null

/**
 * Every week of the term, one tappable row each.
 *
 * The current week opens by default and the rest stay shut: thirteen expanded
 * summaries is not a phone screen. Rows with nothing more to show than their
 * topic do not pretend to be expandable.
 */
function Lectures({ course }: { course: Course }) {
  const [open, setOpen] = useState<number | null>(course.currentWeek)
  if (course.lectures.length === 0) return null

  return (
    <section className="ld-lectures">
      <div className="ld-section-head ld-section-head--sub">
        <h3 className="ld-section-title">WEEK BY WEEK</h3>
        <div className="ld-section-meta">
          {course.lectures.length} {course.lectures.length === 1 ? 'WEEK' : 'WEEKS'}
        </div>
      </div>
      <ol className="ld-lecturelist">
        {course.lectures.map((l) => {
          const now = l.week === course.currentWeek
          const shown = open === l.week

          return (
            <li className={`ld-lec${now ? ' ld-lec--now' : ''}${shown ? ' ld-lec--open' : ''}`} key={l.week}>
              {/* Every week opens, including the ones with nothing to show.
                  A row that silently ignores a tap reads as broken, and "there
                  is no summary for this week" is itself worth being told. */}
              <button
                type="button"
                className="ld-lec__row"
                aria-expanded={shown}
                onClick={() => setOpen(shown ? null : l.week)}
              >
                <span className="ld-lec__week">{l.week}</span>
                <span className="ld-lec__topic">{l.topic || 'No topic recorded'}</span>
                <span className="ld-lec__chevron" aria-hidden="true">
                  <svg viewBox="0 0 12 12" width="12" height="12">
                    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>

              {shown && <LectureBody course={course} lecture={l} />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/**
 * What one week holds, once it is opened.
 *
 * The summary is the point of this panel and it is the one part that cannot be
 * manufactured: every word of it comes from the user's own files. Where there
 * is none, the panel says so and says where one would come from, rather than
 * opening onto a dates line and letting the silence imply the lecture has no
 * content.
 */
function LectureBody({ course, lecture }: { course: Course; lecture: Lecture }) {
  const facts = [
    lecture.dates && { label: 'DATES', text: lecture.dates },
    lecture.readings && { label: 'READING', text: `Chapter ${lecture.readings}` },
  ].filter((f): f is { label: string; text: string } => Boolean(f))

  const folder = course.folder

  return (
    <div className="ld-lec__body">
      {facts.length > 0 && (
        <dl className="ld-lec__facts">
          {facts.map((f) => (
            <div className="ld-lec__fact" key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.text}</dd>
            </div>
          ))}
        </dl>
      )}

      {lecture.detail ? (
        <>
          <ul className="ld-lec__points">
            {lecture.detail.split(' · ').map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          {/* A parsed bullet and a hand-written note should not read as the
              same kind of statement. */}
          {lecture.detailSource === 'slides' && (
            <div className="ld-lec__source">Read off this week&rsquo;s slides</div>
          )}
        </>
      ) : (
        <p className="ld-lec__none">
          No summary for this week — nothing on this Mac says what it covers yet.
          One is read automatically from a lecture deck dropped into{' '}
          {folder ? (
            <code>
              {scanRoot}/{folder.folder}
            </code>
          ) : (
            <>
              a <code>{course.code}</code> folder in <code>{scanRoot}</code>
            </>
          )}
          , or you can write one into <code>lectures.tsv</code>. Either way it
          appears here after the next <code>npm run scan</code>.
        </p>
      )}
    </div>
  )
}

/** Midterms, finals and reading weeks, as the syllabus dated them. */
function Assessments({ course }: { course: Course }) {
  if (course.assessments.length === 0) return null

  return (
    <section className="ld-lectures">
      <h3 className="ld-matgroup__name">Dates</h3>
      <ul className="ld-matlist">
        {course.assessments.map((a) => (
          <li className="ld-mat" key={`${a.label}-${a.dates}`}>
            <span className="ld-mat__name">{a.label}</span>
            <span className="ld-mat__kind">{a.dates}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Materials({ course }: { course: Course }) {
  const folder = course.folder
  if (!folder) return null

  const groups = groupMaterials(folder)

  return (
    <div className="ld-course__materials">
      {scanRedacted ? (
        <div className="ld-course__sections">
          {folder.sections.map((s) => (
            <span className="ld-course__section-chip" key={s}>
              {s}
            </span>
          ))}
        </div>
      ) : (
        groups.map(({ section, items }) => (
          <section className="ld-matgroup" key={section || '(root)'}>
            <h3 className="ld-matgroup__name">{section || 'LOOSE'}</h3>
            <ul className="ld-matlist">
              {items.map((m) => (
                <li className="ld-mat" key={`${section}/${m.name}`}>
                  <span className="ld-mat__name">{stem(m.name)}</span>
                  {KIND_LABEL[m.kind] && <span className="ld-mat__kind">{KIND_LABEL[m.kind]}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

/**
 * What the drawer says it holds.
 *
 * A course whose only extra is a list of exam dates has no lectures and no
 * files to count, and an empty label under a lone chevron reads as a bug. It
 * falls back to naming the drawer rather than counting nothing.
 */
function drawerLabel(c: Course): string {
  const folder = c.folder
  const parts = [
    c.lectures.length > 0 && `${c.lectures.length} LECTURES`,
    folder && folder.fileCount > 0 &&
      `${folder.fileCount} ${folder.fileCount === 1 ? 'FILE' : 'FILES'}`,
    folder?.updated != null && shortDate(folder.updated),
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : 'TERM DATES'
}

interface Props {
  dashboard: Dashboard
  needsKey: boolean
  onSetUp: () => void
  error: string | null
}

export default function CoursesView({ dashboard, needsKey, onSetUp, error }: Props) {
  const { calendar, courses } = dashboard
  const [open, setOpen] = useState<string | null>(null)

  const empty = courses.length === 0

  return (
    <div>
      <header className="ld-page-head ld-page-head--tight">
        <div className="ld-kicker">COURSES</div>
        <h1 className="ld-page-title">Course load</h1>
      </header>

      {empty ? (
        <EmptyState
          kicker={needsKey ? 'CALENDAR' : 'DESKTOP'}
          title={needsKey ? 'Not set up' : 'No courses yet'}
          note={
            needsKey
              ? `Courses come from two places: the recurring class events on your calendar, and the folders in ${scanRoot}. Set this device up for the first, and run \`npm run scan\` on your Mac for the second.`
              : `Nothing on your calendar looks like a class, and ${scanRoot} has no folders named like a course code — try "Econ 2122". Both fill this screen; neither is required.`
          }
          action={needsKey ? { label: 'SET UP THIS DEVICE', onClick: onSetUp } : undefined}
          error={error}
        />
      ) : (
        <div className="ld-courses">
          {courses.map((c) => {
            const expanded = open === c.code
            const folder = c.folder
            return (
              <article key={c.code} className={`ld-course${c.today ? ' ld-course--today' : ''}`}>
                <div className="ld-course__head">
                  <h2 className="ld-course__code">{c.code}</h2>
                  {c.meets ? (
                    <div className="ld-course__meets">{c.meets}</div>
                  ) : (
                    <div className="ld-course__meets ld-course__meets--none">NOT ON CALENDAR</div>
                  )}
                </div>

                {c.name && <div className="ld-course__name">{c.name}</div>}

                {thisWeek(c)?.topic && (
                  <div className="ld-course__now">
                    <span className="ld-course__now-kicker">WEEK {c.currentWeek}</span>
                    <span className="ld-course__now-topic">{thisWeek(c)?.topic}</span>
                    {thisWeek(c)?.detail && (
                      <span className="ld-course__now-detail">
                        {thisWeek(c)!.detail.split(' · ')[0]}
                      </span>
                    )}
                  </div>
                )}

                {c.progress > 0 && (
                  <div
                    className="ld-course__track"
                    role="img"
                    aria-label={`${Math.round(c.progress * 100)}% of lectures delivered`}
                  >
                    <div className="ld-course__fill" style={{ width: `${c.progress * 100}%` }} />
                  </div>
                )}

                {(folder || c.lectures.length > 0 || c.assessments.length > 0) && (
                  <>
                    <button
                      type="button"
                      className="ld-course__toggle"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : c.code)}
                    >
                      <span className="ld-course__count">{drawerLabel(c)}</span>
                      <span className="ld-course__chevron" aria-hidden="true">
                        {expanded ? '–' : '+'}
                      </span>
                    </button>
                    {expanded && (
                      <>
                        <Lectures course={c} />
                        <Assessments course={c} />
                        <Materials course={c} />
                      </>
                    )}
                  </>
                )}

                {!folder && (
                  <div className="ld-course__nofolder">No folder in {scanRoot}</div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {courseFolders.length > 0 && scannedAt !== null && (
        <footer className="ld-rebuild">
          <span className="ld-rebuild__at">DESKTOP</span>
          <span className="ld-rebuild__text">
            Materials read from {scanRoot} on {shortDate(scannedAt)}. This is a snapshot taken when
            the app was last deployed, not a live view of your Mac — run <code>npm run scan</code>{' '}
            and deploy to update it.
            {calendar === 'ready' && ' Meeting times come from the calendar and are live.'}
          </span>
        </footer>
      )}
    </div>
  )
}

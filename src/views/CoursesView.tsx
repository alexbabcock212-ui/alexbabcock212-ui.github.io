import { useState } from 'react'
import EmptyState from '../components/EmptyState'
import { shortDate } from '../data/dashboard'
import { courseFolders, scanRedacted, scanRoot, scannedAt } from '../data/courses'
import { groupMaterials } from '../data/sources/courses'
import type { Course, Dashboard, MaterialKind } from '../data/types'

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
const thisWeek = (c: Course) =>
  c.lectures.find((l) => l.week === c.currentWeek)?.topic ?? null

/** Every week of the term, with the current one called out. */
function Lectures({ course }: { course: Course }) {
  if (course.lectures.length === 0) return null

  return (
    <section className="ld-lectures">
      <h3 className="ld-matgroup__name">Lectures</h3>
      <ol className="ld-lecturelist">
        {course.lectures.map((l) => {
          const now = l.week === course.currentWeek
          return (
            <li className={`ld-lec${now ? ' ld-lec--now' : ''}`} key={l.week}>
              <span className="ld-lec__week">{l.week}</span>
              <span className="ld-lec__topic">{l.topic}</span>
            </li>
          )
        })}
      </ol>
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

                {thisWeek(c) && (
                  <div className="ld-course__now">
                    <span className="ld-course__now-kicker">WEEK {c.currentWeek}</span>
                    <span className="ld-course__now-topic">{thisWeek(c)}</span>
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

                {(folder || c.lectures.length > 0) && (
                  <>
                    <button
                      type="button"
                      className="ld-course__toggle"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : c.code)}
                    >
                      <span className="ld-course__count">
                        {c.lectures.length > 0 && `${c.lectures.length} LECTURES`}
                        {c.lectures.length > 0 && folder && folder.fileCount > 0 && ' · '}
                        {folder && folder.fileCount > 0 &&
                          `${folder.fileCount} ${folder.fileCount === 1 ? 'FILE' : 'FILES'}`}
                        {folder?.updated != null && ` · ${shortDate(folder.updated)}`}
                      </span>
                      <span className="ld-course__chevron" aria-hidden="true">
                        {expanded ? '–' : '+'}
                      </span>
                    </button>
                    {expanded && (
                      <>
                        <Lectures course={c} />
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

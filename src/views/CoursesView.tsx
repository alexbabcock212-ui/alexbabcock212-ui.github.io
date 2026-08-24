import EmptyState from '../components/EmptyState'
import type { Dashboard } from '../data/types'

export default function CoursesView({ dashboard }: { dashboard: Dashboard }) {
  const { calendar, courses } = dashboard

  return (
    <div>
      <header className="ld-page-head ld-page-head--tight">
        <div className="ld-kicker">COURSES</div>
        <h1 className="ld-page-title">Course load</h1>
      </header>

      {courses.length === 0 ? (
        <EmptyState
          kicker="CALENDAR"
          title={calendar === 'ready' ? 'No classes yet' : 'Not connected'}
          note={
            calendar === 'ready'
              ? "Nothing on your calendar looks like a class. Courses appear here once the term's timetable lands."
              : 'Connect Google and your courses are read from the recurring class events on your calendar.'
          }
        />
      ) : (
        <div className="ld-courses">
          {courses.map((c) => (
            <article key={c.code} className={`ld-course${c.today ? ' ld-course--today' : ''}`}>
              <div className="ld-course__head">
                <h2 className="ld-course__code">{c.code}</h2>
                <div className="ld-course__meets">{c.meets}</div>
              </div>
              <div className="ld-course__name">{c.name}</div>
              {c.progress > 0 && (
                <div
                  className="ld-course__track"
                  role="img"
                  aria-label={`${Math.round(c.progress * 100)}% of lectures delivered`}
                >
                  <div className="ld-course__fill" style={{ width: `${c.progress * 100}%` }} />
                </div>
              )}
              {c.facts.length > 0 && (
                <dl className="ld-course__facts">
                  {c.facts.map((f) => (
                    <div className="ld-deflist__row" key={f.label}>
                      <dt className="ld-deflist__label">{f.label}</dt>
                      <dd>{f.text}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

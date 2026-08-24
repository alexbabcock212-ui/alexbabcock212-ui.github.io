import { courses, termHeader } from '../data/dashboard'

export default function CoursesView() {
  return (
    <div>
      <header className="ld-page-head ld-page-head--tight">
        <div className="ld-kicker">{termHeader.kicker}</div>
        <h1 className="ld-page-title">{termHeader.title}</h1>
        <p className="ld-page-sub">{termHeader.sub}</p>
      </header>

      <div className="ld-courses">
        {courses.map((c) => (
          <article key={c.code} className={`ld-course${c.today ? ' ld-course--today' : ''}`}>
            <div className="ld-course__head">
              <h2 className="ld-course__code">{c.code}</h2>
              <div className="ld-course__meets">{c.meets}</div>
            </div>
            <div className="ld-course__name">{c.name}</div>
            <div
              className="ld-course__track"
              role="img"
              aria-label={`${Math.round(c.progress * 100)}% of lectures delivered`}
            >
              <div className="ld-course__fill" style={{ width: `${c.progress * 100}%` }} />
            </div>
            <dl className="ld-course__facts">
              {c.facts.map((f) => (
                <div className="ld-deflist__row" key={f.label}>
                  <dt className="ld-deflist__label">{f.label}</dt>
                  <dd>{f.text}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </div>
  )
}

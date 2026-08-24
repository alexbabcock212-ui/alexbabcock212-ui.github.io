import { clusters, inboxHeader } from '../data/dashboard'

export default function MailView() {
  return (
    <div>
      <header className="ld-page-head ld-page-head--onDark">
        <div className="ld-kicker ld-kicker--onDark">{inboxHeader.kicker}</div>
        <h1 className="ld-page-title">{inboxHeader.title}</h1>
        <p className="ld-page-sub">{inboxHeader.sub}</p>
      </header>

      <div className="ld-clusters">
        {clusters.map((c) => (
          <article key={c.id} className={`ld-cluster${c.live ? ' ld-cluster--live' : ''}`}>
            <div className="ld-cluster__head">
              <h2 className="ld-cluster__name">{c.name}</h2>
              <div className="ld-cluster__count">{c.count}</div>
            </div>
            <p className="ld-cluster__summary">{c.summary}</p>
            <span className="ld-cluster__tag">{c.tag}</span>
          </article>
        ))}
      </div>
    </div>
  )
}

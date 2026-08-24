import EmptyState from '../components/EmptyState'
import type { Dashboard } from '../data/types'

export default function MailView({ dashboard }: { dashboard: Dashboard }) {
  const { mail, clusters } = dashboard

  return (
    <div>
      <header className="ld-page-head ld-page-head--onDark">
        <div className="ld-kicker ld-kicker--onDark">INBOX</div>
        <h1 className="ld-page-title">Mail, summarized</h1>
      </header>

      {clusters.length === 0 ? (
        <EmptyState
          kicker="GMAIL"
          title={mail === 'ready' ? 'Nothing waiting' : 'Not connected'}
          note={
            mail === 'ready'
              ? 'No unread mail that wants a reply.'
              : 'Connect Google and your unread mail is grouped here into the threads that actually want an answer.'
          }
        />
      ) : (
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
      )}
    </div>
  )
}

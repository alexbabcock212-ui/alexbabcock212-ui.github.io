import EmptyState from '../components/EmptyState'
import Spark from '../components/Spark'
import type { Dashboard, Quote } from '../data/types'

/** One row of the board. The sparkline sits between name and number so the
 *  eye can run down a column of levels without a chart interrupting it. */
function Row({ quote }: { quote: Quote }) {
  return (
    <li className={`ld-quote ld-quote--${quote.direction}`}>
      <div className="ld-quote__name">
        <span className="ld-quote__label">{quote.label}</span>
        <span className="ld-quote__sub">
          {quote.sub}
          {quote.time && <span className="ld-quote__time"> · {quote.time}</span>}
        </span>
      </div>
      <div className="ld-quote__spark">
        <Spark points={quote.spark} />
      </div>
      <div className="ld-quote__figures">
        <span className="ld-quote__value">{quote.value}</span>
        <span className="ld-quote__change">{quote.percent || quote.change}</span>
      </div>
    </li>
  )
}

/** The one row the screen opens with, at the size of a headline. */
function Lead({ quote }: { quote: Quote }) {
  return (
    <section className={`ld-lead ld-lead--${quote.direction}`}>
      <div className="ld-lead__head">
        <div>
          <div className="ld-lead__label">{quote.label}</div>
          <div className="ld-lead__sub">
            {quote.sub}
            {quote.time && ` · ${quote.time}`}
          </div>
        </div>
        <div className="ld-lead__move">
          <span className="ld-lead__percent">{quote.percent || quote.change}</span>
          {quote.percent && <span className="ld-lead__change">{quote.change}</span>}
        </div>
      </div>
      <div className="ld-lead__value">{quote.value}</div>
      <div className="ld-lead__chart">
        <Spark points={quote.spark} filled />
      </div>
    </section>
  )
}

interface Props {
  dashboard: Dashboard
  onRefresh: () => void
  busy: boolean
  error: string | null
}

export default function MarketsView({ dashboard, onRefresh, busy, error }: Props) {
  const { quotes, news, markets } = dashboard
  const { lead, groups, headlines, brief } = markets

  return (
    <div>
      <header className="ld-page-head">
        <div className="ld-kicker">MARKETS</div>
        <h1 className="ld-page-title">Where things stand</h1>
        {brief && <p className="ld-page-sub">{brief}</p>}
      </header>

      {groups.length === 0 ? (
        <EmptyState
          kicker="QUOTES"
          title={quotes === 'error' ? 'Could not load' : 'Reading the tape…'}
          note={
            quotes === 'error'
              ? 'The quote service could not be reached. It needs no key and no account, so this is almost always the other end rather than this device.'
              : 'North American indexes, rates, the loonie, commodities and the overnight sessions land here.'
          }
          action={quotes === 'error' ? { label: 'TRY AGAIN', onClick: onRefresh } : undefined}
          error={error}
        />
      ) : (
        <>
          {lead && <Lead quote={lead} />}

          {groups.map((group) => (
            <section className="ld-band" key={group.title}>
              <div className="ld-section-head">
                <h2 className="ld-section-title">{group.title}</h2>
                {group.meta && <div className="ld-section-meta">{group.meta}</div>}
              </div>
              <ul className="ld-quotes">
                {group.quotes.map((quote) => (
                  <Row quote={quote} key={quote.symbol} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {headlines.length > 0 && (
        <section className="ld-band">
          <div className="ld-section-head">
            <h2 className="ld-section-title">WHAT&rsquo;S MOVING</h2>
            <div className="ld-section-meta">HEADLINES</div>
          </div>
          <ul className="ld-headlines">
            {headlines.map((h) => (
              <li key={h.id}>
                <a className="ld-headline" href={h.url} target="_blank" rel="noreferrer noopener">
                  <span className="ld-headline__meta">
                    <span className="ld-headline__source">{h.source}</span>
                    <span className="ld-headline__when">{h.when}</span>
                  </span>
                  <span className="ld-headline__title">{h.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <footer className="ld-rebuild">
          <span className="ld-rebuild__at">SOURCES</span>
          <span className="ld-rebuild__text">
            Levels and the previous close come from a public quote feed;
            {news === 'ready' ? ' headlines are the newsrooms’ own RSS, titles only.' : ' headlines could not be read this time.'}{' '}
            A row is only as live as the time beside it, and a closed market
            shows where it finished. Nothing here is advice.{' '}
            <button type="button" className="ld-refresh" onClick={onRefresh} disabled={busy}>
              {busy ? 'Refreshing…' : 'Refresh now'}
            </button>
          </span>
        </footer>
      )}
    </div>
  )
}

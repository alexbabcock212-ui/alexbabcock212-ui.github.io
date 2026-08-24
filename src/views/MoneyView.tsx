import EmptyState from '../components/EmptyState'
import type { Dashboard } from '../data/types'

export default function MoneyView({ dashboard }: { dashboard: Dashboard }) {
  const { netWorth, moneyStats, positions, outflows } = dashboard

  if (!netWorth && positions.length === 0 && outflows.length === 0) {
    return (
      <div>
        <header className="ld-page-head">
          <div className="ld-kicker">MONEY</div>
          <h1 className="ld-page-title">Net worth</h1>
        </header>
        <EmptyState
          kicker="ACCOUNTS"
          title="Nothing entered"
          note="No brokerage exposes an API a browser can call, so this screen is filled in by hand rather than automatically. Balances you enter stay on this device."
        />
      </div>
    )
  }

  return (
    <div>
      {netWorth && (
        <header className="ld-networth">
          <div className="ld-kicker ld-kicker--onDark">{netWorth.kicker}</div>
          <h1 className="ld-networth__value">{netWorth.value}</h1>
          <p className="ld-networth__delta">{netWorth.delta}</p>
        </header>
      )}

      {moneyStats.length > 0 && (
        <div className="ld-stats">
          {moneyStats.map((s) => (
            <div key={s.label} className={`ld-stat${s.lead ? ' ld-stat--lead' : ''}`}>
              <div className="ld-stat__label">{s.label}</div>
              <div className="ld-stat__value">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {positions.length > 0 && (
        <>
          <h2 className="ld-block-title">POSITIONS</h2>
          <div className="ld-positions">
            {positions.map((p) => (
              <div className="ld-position" key={p.symbol}>
                <span className="ld-position__name">
                  {p.symbol} <span className="ld-position__desc">{p.desc}</span>
                </span>
                <span className="ld-position__value">{p.value}</span>
                <span className={`ld-position__change ld-position__change--${p.changeTone}`}>
                  {p.change}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {outflows.length > 0 && (
        <>
          <h2 className="ld-block-title">LEAVING SOON</h2>
          <div className="ld-outflows">
            {outflows.map((o) => (
              <div className="ld-outflow" key={o.label}>
                <span>{o.label}</span>
                <span className="ld-outflow__amount">{o.amount}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

import { moneyCallout, moneyStats, netWorth, outflows, positions } from '../data/dashboard'

export default function MoneyView() {
  return (
    <div>
      <header className="ld-networth">
        <div className="ld-kicker ld-kicker--onDark">{netWorth.kicker}</div>
        <h1 className="ld-networth__value">{netWorth.value}</h1>
        <p className="ld-networth__delta">{netWorth.delta}</p>
      </header>

      <div className="ld-stats">
        {moneyStats.map((s) => (
          <div key={s.label} className={`ld-stat${s.lead ? ' ld-stat--lead' : ''}`}>
            <div className="ld-stat__label">{s.label}</div>
            <div className="ld-stat__value">{s.value}</div>
          </div>
        ))}
      </div>

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

      <h2 className="ld-block-title">LEAVING SOON</h2>
      <div className="ld-outflows">
        {outflows.map((o) => (
          <div className="ld-outflow" key={o.label}>
            <span>{o.label}</span>
            <span className="ld-outflow__amount">{o.amount}</span>
          </div>
        ))}
      </div>

      <p className="ld-callout">{moneyCallout}</p>
    </div>
  )
}

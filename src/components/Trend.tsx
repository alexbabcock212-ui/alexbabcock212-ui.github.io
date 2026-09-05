import type { GroceryWeek } from '../data/types'

interface Props {
  /** Oldest first. Twelve of them, though it draws whatever it is given. */
  weeks: GroceryWeek[]
  /** Dollars a week being aimed at — the line across the bars. */
  target: number
}

/**
 * Twelve weeks of food against the number you are aiming at.
 *
 * Two bars in the same slot rather than two charts: the solid one is what the
 * week cost once every purchase was spread over how long it lasts, the ghost
 * behind it is what actually left the account. They come apart on exactly the
 * weeks worth noticing — a stock-up shows a tall ghost and a short bar, and the
 * quiet fortnight after it shows the reverse.
 *
 * The scale follows the weeks, not the target. A $150 target over a $16 week
 * would press every bar flat against the floor and leave the one thing this
 * chart is for — how the weeks differ — unreadable. The target line is drawn
 * when it falls on the chart, which is exactly when you are close enough to it
 * for the comparison to mean anything; the card above states it either way.
 */
export default function Trend({ weeks, target }: Props) {
  const peak = Math.max(0, ...weeks.map((w) => Math.max(w.spread, w.cash)))
  // Headroom, so the tallest bar is not flush with the top of the box.
  const scale = (peak || target) * 1.25 || 1
  const height = (v: number) => `${Math.max((v / scale) * 100, v > 0 ? 1.5 : 0)}%`
  const showTarget = target > 0 && target <= scale

  return (
    <div className="ld-trend">
      <div className="ld-trend__plot">
        {showTarget && (
          <div className="ld-trend__target" style={{ bottom: `${(target / scale) * 100}%` }}>
            <span className="ld-trend__target-label">${target}</span>
          </div>
        )}

        {weeks.map((w) => (
          <div
            key={w.start}
            className={`ld-trend__week${w.current ? ' is-now' : ''}`}
            title={`${w.label}: $${w.spread.toFixed(2)} a week, $${w.cash.toFixed(2)} out`}
          >
            <div className="ld-trend__bars">
              <i className="ld-trend__cash" style={{ height: height(w.cash) }} aria-hidden="true" />
              <i
                className="ld-trend__spread"
                style={{ height: height(w.spread) }}
                aria-hidden="true"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="ld-trend__axis">
        <span>{weeks[0]?.label}</span>
        <span className="ld-trend__legend">
          <i className="ld-trend__key ld-trend__key--spread" aria-hidden="true" /> a week
          <i className="ld-trend__key ld-trend__key--cash" aria-hidden="true" /> paid out
        </span>
        <span>NOW</span>
      </div>
    </div>
  )
}

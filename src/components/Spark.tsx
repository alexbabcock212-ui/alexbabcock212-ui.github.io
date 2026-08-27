/**
 * A session drawn small.
 *
 * The points arrive already normalised to 0–1 (`normalise` in
 * `data/sources/markets.ts`), so this is pure geometry: no scale, no axis, no
 * label. It inherits `currentColor`, which is how a row's direction colours its
 * own line without this component knowing what a market is.
 *
 * `vector-effect` keeps the stroke one pixel wide however far the viewBox is
 * stretched — without it a 100×100 box squeezed into 56×22 draws a wedge.
 */
interface Props {
  /** Oldest first, each 0–1. Fewer than two points draws nothing. */
  points: number[]
  /** Filled area beneath the line — for the one row that leads the screen. */
  filled?: boolean
}

export default function Spark({ points, filled = false }: Props) {
  if (points.length < 2) return null

  const step = 100 / (points.length - 1)
  const line = points.map((v, i) => `${(i * step).toFixed(2)},${(100 - v * 100).toFixed(2)}`)

  return (
    <svg
      className="ld-spark"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {filled && (
        <polygon className="ld-spark__area" points={`0,100 ${line.join(' ')} 100,100`} />
      )}
      <polyline
        className="ld-spark__line"
        points={line.join(' ')}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

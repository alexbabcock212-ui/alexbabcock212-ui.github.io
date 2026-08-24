import Corners from './Corners'

interface Props {
  /** Which source this screen is waiting on, e.g. `CALENDAR`. */
  kicker: string
  title: string
  note: string
  /** Optional call to action, e.g. connecting the source. */
  action?: { label: string; onClick: () => void }
  /** Shown beneath, when the last attempt failed. */
  error?: string | null
}

/**
 * What a screen shows when it has no real data.
 *
 * Deliberately reads as a blueprint placeholder — a hairline frame with the
 * design's registration marks — so it looks like part of the system rather
 * than an error, while never implying content exists.
 */
export default function EmptyState({ kicker, title, note, action, error }: Props) {
  return (
    <div className="ld-empty">
      <Corners variant="outset" />
      <div className="ld-empty__kicker">{kicker}</div>
      <div className="ld-empty__title">{title}</div>
      <p className="ld-empty__note">{note}</p>
      {action && (
        <button type="button" className="ld-connect" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {error && <p className="ld-empty__error">{error}</p>}
    </div>
  )
}

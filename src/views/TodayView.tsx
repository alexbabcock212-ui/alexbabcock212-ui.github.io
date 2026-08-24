import Corners from '../components/Corners'
import EmptyState from '../components/EmptyState'
import { dateKicker, freshness, salutation } from '../data/dashboard'
import { MORNING_HOUR, MORNING_MINUTE } from '../data/morning'
import type { Dashboard, Slot } from '../data/types'

const formatHours = (h: number) => `${h}H`

/** The one slot the day pivots on gets the anchored rail; the evening block
 *  takes over the time gutter entirely. */
function slotModifier(slot: Slot) {
  if (slot.kind === 'highlight') return ' ld-slot--now'
  if (slot.kind === 'feature' || slot.kind === 'minor') return ' ld-slot--anchor'
  return ''
}

function SlotBody({ slot }: { slot: Slot }) {
  switch (slot.kind) {
    case 'plain':
      return (
        <>
          <div className="ld-slot__title">{slot.title}</div>
          {slot.note && <div className="ld-slot__note">{slot.note}</div>}
        </>
      )
    case 'feature':
      return (
        <div className="ld-lecture">
          <Corners variant="outset" />
          <div className="ld-lecture__head">
            <div className="ld-lecture__where">{slot.where}</div>
            {slot.seq && <div className="ld-lecture__seq">{slot.seq}</div>}
          </div>
          <h2 className="ld-lecture__title">{slot.title}</h2>
          {slot.facts.length > 0 && (
            <dl className="ld-deflist">
              {slot.facts.map((f) => (
                <div className="ld-deflist__row" key={f.label}>
                  <dt className="ld-deflist__label">{f.label}</dt>
                  <dd>{f.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )
    case 'minor':
      return (
        <div className="ld-minor">
          <div className="ld-minor__head">
            <div className="ld-minor__where">{slot.where}</div>
            {slot.seq && <div className="ld-minor__seq">{slot.seq}</div>}
          </div>
          <h2 className="ld-minor__title">{slot.title}</h2>
          {slot.note && <div className="ld-minor__note">{slot.note}</div>}
        </div>
      )
    case 'highlight':
      return (
        <div className="ld-highlight">
          {slot.kicker && <div className="ld-highlight__kicker">{slot.kicker}</div>}
          <h2 className="ld-highlight__title">{slot.title}</h2>
          {slot.note && <div className="ld-highlight__note">{slot.note}</div>}
        </div>
      )
  }
}

function Allocation({ allocation }: { allocation: Dashboard['allocation'] }) {
  const planned = allocation.reduce((sum, s) => sum + s.hours, 0)
  if (!planned) return null

  return (
    <section className="ld-alloc">
      <div className="ld-section-head">
        <h2 className="ld-section-title">WHERE THE {planned} HOURS GO</h2>
        <div className="ld-section-meta">PLANNED</div>
      </div>
      <div
        className="ld-alloc__bar"
        role="img"
        aria-label={allocation.map((s) => `${s.label} ${formatHours(s.hours)}`).join(', ')}
      >
        {allocation.map((s) => (
          <div
            key={s.label}
            style={{ width: `${(s.hours / planned) * 100}%`, background: s.color ?? 'transparent' }}
          />
        ))}
      </div>
      <div className="ld-alloc__legend">
        {allocation.map((s) => (
          <div className="ld-alloc__item" key={s.label}>
            <i
              className={`ld-swatch${s.color ? '' : ' ld-swatch--open'}`}
              style={s.color ? { background: s.color } : undefined}
            />
            {s.label} · {formatHours(s.hours)}
          </div>
        ))}
      </div>
    </section>
  )
}

interface Props {
  userName: string
  dashboard: Dashboard
  /** No working key on this device — the only thing setup can fix. */
  needsKey: boolean
  busy: boolean
  onSetUp: () => void
  onRefresh: () => void
  error: string | null
}

export default function TodayView({
  userName,
  dashboard,
  needsKey,
  busy,
  onSetUp,
  onRefresh,
  error,
}: Props) {
  const { calendar, schedule, allocation, lede, chips, fetchedAt } = dashboard
  const connected = calendar === 'ready'
  const loading = busy && fetchedAt === null

  return (
    <div>
      <header className="ld-brief">
        <Corners variant="inset" />
        <div className="ld-kicker ld-kicker--onDark">{dateKicker()}</div>
        <h1 className="ld-brief__title">
          {salutation()}, {userName}.
          {connected && schedule.length > 0 && (
            <>
              <br />
              {schedule.length} {schedule.length === 1 ? 'block' : 'blocks'} today.
            </>
          )}
        </h1>
        {lede && <p className="ld-brief__lede">{lede}</p>}
        {chips.length > 0 && (
          <div className="ld-chips">
            {chips.map((c) => (
              <span key={c.label} className={`ld-chip ld-chip--${c.tone}`}>
                {c.label}
              </span>
            ))}
          </div>
        )}
      </header>

      {loading ? (
        <EmptyState kicker="CALENDAR" title="Reading your day…" note="One moment." />
      ) : !connected ? (
        <EmptyState
          kicker="CALENDAR"
          title={needsKey ? 'Not set up' : 'Could not load'}
          note={
            needsKey
              ? 'This device needs its dashboard key once. After that the day assembles itself each morning — hour by hour, with the hours nobody has claimed.'
              : 'The dashboard service could not read your calendar. Your last read is still below if there was one.'
          }
          action={
            needsKey
              ? { label: 'SET UP THIS DEVICE', onClick: onSetUp }
              : { label: 'TRY AGAIN', onClick: onRefresh }
          }
          error={error}
        />
      ) : schedule.length === 0 ? (
        <EmptyState
          kicker="CALENDAR"
          title="Nothing scheduled"
          note="No events on your calendar today. The whole day is unclaimed."
        />
      ) : (
        <>
          <Allocation allocation={allocation} />

          <div className="ld-timeline__head">
            <h2 className="ld-section-title">HOUR BY HOUR</h2>
            <div className="ld-section-meta ld-section-meta--faint">
              {schedule.length} {schedule.length === 1 ? 'BLOCK' : 'BLOCKS'}
            </div>
          </div>

          <section className="ld-timeline">
            {schedule.map((slot) => (
              <div className={`ld-slot${slotModifier(slot)}`} key={slot.id}>
                <div className="ld-slot__time">{slot.time}</div>
                <div className="ld-slot__body">
                  <SlotBody slot={slot} />
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {fetchedAt !== null && (
        <footer className="ld-rebuild">
          <span className="ld-rebuild__at">SOURCES</span>
          <span className="ld-rebuild__text">
            Calendar, tasks and mail, {freshness(fetchedAt)}. Refreshed every morning at{' '}
            {MORNING_HOUR}:{String(MORNING_MINUTE).padStart(2, '0')} and whenever you come back to
            it. A fortnight is kept on this device, so it opens without a network.{' '}
            <button type="button" className="ld-refresh" onClick={onRefresh} disabled={busy}>
              {busy ? 'Refreshing…' : 'Refresh now'}
            </button>
            {error && <span className="ld-rebuild__warn">{error}</span>}
          </span>
        </footer>
      )}
    </div>
  )
}

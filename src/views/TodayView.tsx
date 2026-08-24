import Corners from '../components/Corners'
import { allocation, brief, schedule } from '../data/dashboard'
import type { Slot } from '../data/types'

const plannedHours = allocation.reduce((sum, s) => sum + s.hours, 0)
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
          <div className="ld-slot__note">{slot.note}</div>
        </>
      )
    case 'feature':
      return (
        <div className="ld-lecture">
          <Corners variant="outset" />
          <div className="ld-lecture__head">
            <div className="ld-lecture__where">{slot.where}</div>
            <div className="ld-lecture__seq">{slot.seq}</div>
          </div>
          <h2 className="ld-lecture__title">{slot.title}</h2>
          <dl className="ld-deflist">
            {slot.facts.map((f) => (
              <div className="ld-deflist__row" key={f.label}>
                <dt className="ld-deflist__label">{f.label}</dt>
                <dd>{f.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )
    case 'minor':
      return (
        <div className="ld-minor">
          <div className="ld-minor__head">
            <div className="ld-minor__where">{slot.where}</div>
            <div className="ld-minor__seq">{slot.seq}</div>
          </div>
          <h2 className="ld-minor__title">{slot.title}</h2>
          <div className="ld-minor__note">{slot.note}</div>
        </div>
      )
    case 'highlight':
      return (
        <div className="ld-highlight">
          <div className="ld-highlight__kicker">{slot.kicker}</div>
          <h2 className="ld-highlight__title">{slot.title}</h2>
          <div className="ld-highlight__note">{slot.note}</div>
        </div>
      )
  }
}

export default function TodayView({ userName }: { userName: string }) {
  return (
    <div>
      <header className="ld-brief">
        <Corners variant="inset" />
        <div className="ld-kicker ld-kicker--onDark">{brief.kicker}</div>
        <h1 className="ld-brief__title">
          {brief.salutation}, {userName}.
          <br />
          {brief.focus}
        </h1>
        <p className="ld-brief__lede">{brief.lede}</p>
        <div className="ld-chips">
          {brief.chips.map((c) => (
            <span key={c.label} className={`ld-chip ld-chip--${c.tone}`}>
              {c.label}
            </span>
          ))}
        </div>
      </header>

      <section className="ld-alloc">
        <div className="ld-section-head">
          <h2 className="ld-section-title">WHERE THE {plannedHours} HOURS GO</h2>
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
              style={{
                width: `${(s.hours / plannedHours) * 100}%`,
                background: s.color ?? 'transparent',
              }}
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

      <div className="ld-timeline__head">
        <h2 className="ld-section-title">HOUR BY HOUR</h2>
        <div className="ld-section-meta ld-section-meta--faint">{schedule.length} BLOCKS</div>
      </div>

      <section className="ld-timeline">
        {schedule.map((slot) => (
          <div className={`ld-slot${slotModifier(slot)}`} key={slot.time}>
            <div className="ld-slot__time">{slot.time}</div>
            <div className="ld-slot__body">
              <SlotBody slot={slot} />
            </div>
          </div>
        ))}
      </section>

      <footer className="ld-rebuild">
        <span className="ld-rebuild__at">{brief.rebuiltAt}</span>
        <span className="ld-rebuild__text">{brief.rebuiltNote}</span>
      </footer>
    </div>
  )
}

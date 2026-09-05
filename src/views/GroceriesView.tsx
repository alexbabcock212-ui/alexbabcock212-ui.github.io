import { useEffect, useMemo, useState } from 'react'
import EmptyState from '../components/EmptyState'
import Trend from '../components/Trend'
import { CATEGORY_WEEKS, correct, itemKey, receiptTotal, toGroceries } from '../data/groceries'
import type { LineEdit, PantryEdits } from '../data/groceries'
import { loadEdits, pantryRoot, receipts, saveEdits, scannedAt, weeklyTarget } from '../data/pantry'
import type { GroceryCategory, LifespanSource, Receipt, ReceiptLine } from '../data/types'

const CATEGORIES = Object.keys(CATEGORY_WEEKS) as GroceryCategory[]

/** Who decided a lifespan, said in words rather than in a code. */
const SAYS: Record<LifespanSource, string> = {
  you: 'you set this',
  pace: 'how often you rebuy it',
  receipt: 'read off the receipt',
  category: 'a category default',
}

const dollars = (n: number) => `$${n.toFixed(2)}`

/** `2`, `1.5` — a lifespan reads as a number of weeks, not as a float. */
const weeksLabel = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1))

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const dueLabel = (days: number) => {
  if (days < 0) return `${-days}D AGO`
  if (days === 0) return 'TODAY'
  return `IN ${days}D`
}

/** What a line says before you have touched it, as text a field can hold. */
interface Draft {
  item: string
  category: GroceryCategory
  qty: string
  price: string
  weeks: string
}

const draftOf = (line: ReceiptLine): Draft => ({
  item: line.item,
  category: line.category,
  qty: String(line.qty),
  price: line.price.toFixed(2),
  weeks: line.estimate === null ? '' : weeksLabel(line.estimate),
})

/**
 * What a week of food costs.
 *
 * The screen owns its own state rather than taking it from the dashboard: none
 * of this comes from the Worker. The receipts are baked in at deploy time and
 * the corrections live in this browser, so every figure here is recomputed from
 * the two of them at render — which is the whole reason correcting a lifespan
 * fixes the past as well as the present.
 */
export default function GroceriesView() {
  const [edits, setEdits] = useState<PantryEdits>(loadEdits)
  const [open, setOpen] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [openItem, setOpenItem] = useState<string | null>(null)

  // Read once per mount, not once per render: every figure below is keyed to
  // which week it is, and none of them should shift because a correction was
  // typed either side of midnight.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    saveEdits(edits)
  }, [edits])

  const groceries = useMemo(
    () => toGroceries(receipts, edits, now, weeklyTarget, scannedAt),
    [edits, now],
  )

  const { pending, pendingTotal, weeks, items, restock, moves } = groceries

  /* ── reviewing ── */

  const startReview = (receipt: Receipt) => {
    if (open === receipt.id) {
      setOpen(null)
      return
    }
    setOpen(receipt.id)
    setDrafts((prev) => {
      const next = { ...prev }
      for (const line of correct(receipt, edits)) next[line.id] ??= draftOf(line)
      return next
    })
  }

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  /** Strike a line out. It stays in the file — this only stops it counting. */
  const drop = (id: string) =>
    setEdits((prev) => ({ ...prev, dropped: { ...prev.dropped, [id]: true } }))

  /**
   * Commit the corrections and let the receipt count.
   *
   * Only fields that actually changed are written, so a receipt read correctly
   * and waved through leaves no corrections behind at all — which keeps "what
   * the photo said" and "what you said" apart for good.
   */
  const keep = (receipt: Receipt) => {
    setEdits((prev) => {
      const lines: Record<string, LineEdit> = { ...prev.lines }
      const lifespan = { ...prev.lifespan }

      for (const line of correct(receipt, prev)) {
        const draft = drafts[line.id]
        if (!draft) continue

        const edit: LineEdit = {}
        if (draft.item.trim() && draft.item.trim() !== line.item) edit.item = draft.item.trim()
        if (draft.category !== line.category) edit.category = draft.category

        const qty = Number(draft.qty)
        if (Number.isFinite(qty) && qty >= 1 && Math.round(qty) !== line.qty) {
          edit.qty = Math.round(qty)
        }

        const price = Number(draft.price)
        if (Number.isFinite(price) && price > 0 && price !== line.price) edit.price = price

        if (Object.keys(edit).length > 0) lines[line.id] = { ...lines[line.id], ...edit }

        // A lifespan typed here is a lifespan for the *thing*, not for this
        // purchase of it — that is what makes it outrank every later guess.
        const weeks = Number(draft.weeks)
        if (Number.isFinite(weeks) && weeks > 0 && weeks !== line.estimate) {
          lifespan[itemKey(edit.item ?? line.item)] = weeks
        }
      }

      return { ...prev, lines, lifespan, reviewed: { ...prev.reviewed, [receipt.id]: true } }
    })
    setOpen(null)
  }

  /** Set for good how long something lasts, from the list of what it costs. */
  const setLifespan = (key: string, raw: string) => {
    const weeks = Number(raw)
    setEdits((prev) => {
      const lifespan = { ...prev.lifespan }
      if (raw.trim() === '' || !Number.isFinite(weeks) || weeks <= 0) delete lifespan[key]
      else lifespan[key] = weeks
      return { ...prev, lifespan }
    })
  }

  /* ── the screen ── */

  if (receipts.length === 0) {
    return (
      <div>
        <header className="ld-page-head">
          <div className="ld-kicker">FOOD</div>
          <h1 className="ld-page-title">Groceries</h1>
        </header>
        <EmptyState
          kicker="RECEIPTS"
          title="Nothing read yet"
          note={`Drop a receipt photo in ${pantryRoot}, then run npm run receipts. Its line items are read and land here waiting to be checked, and the photo moves to Filed/ rather than being deleted.`}
        />
      </div>
    )
  }

  return (
    <div>
      <header className="ld-page-head">
        <div className="ld-kicker">FOOD</div>
        <h1 className="ld-page-title">Groceries</h1>
        <p className="ld-page-sub">
          What the week costs, with everything spread over how long it lasts — not what you happened
          to pay out in it.
        </p>
      </header>

      <section className="ld-spend">
        <div className="ld-spend__head">
          <div className="ld-spend__kicker">THIS WEEK</div>
          <div className="ld-spend__target">
            {groceries.perWeek <= groceries.target ? 'UNDER' : 'OVER'} · TARGET ${groceries.target}
          </div>
        </div>

        <div className="ld-spend__figure">
          <span className="ld-spend__value">{dollars(groceries.perWeek)}</span>
          <span className="ld-spend__unit">/WK</span>
        </div>

        <div className="ld-spend__second">
          {dollars(groceries.cash)} paid out
          {groceries.typical > 0 && ` · a normal week is ${dollars(groceries.typical)}`}
        </div>

        <Trend weeks={weeks} target={groceries.target} />
      </section>

      {pending.length > 0 && (
        <section className="ld-band">
          <div className="ld-section-head">
            <h2 className="ld-section-title">ADD</h2>
            <div className="ld-section-meta">
              {pending.length} WAITING · {dollars(pendingTotal)}
            </div>
          </div>

          <p className="ld-note">
            Read, but not counted yet. Check the lines — a misread price or category is the one thing
            that quietly bends every figure above.
          </p>

          <ul className="ld-receipts">
            {pending.map((receipt) => {
              const lines = correct(receipt, edits)
              const expanded = open === receipt.id
              return (
                <li key={receipt.id} className={`ld-receipt${expanded ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="ld-receipt__head"
                    aria-expanded={expanded}
                    onClick={() => startReview(receipt)}
                  >
                    <span>
                      <span className="ld-receipt__store">{receipt.store || 'Receipt'}</span>
                      <span className="ld-receipt__meta">
                        {shortDate(new Date(`${receipt.date}T12:00`).getTime())} ·{' '}
                        {lines.length} lines
                        {receipt.total !== null && ` · printed ${dollars(receipt.total)}`}
                      </span>
                    </span>
                    <span className="ld-receipt__sum">{dollars(receiptTotal(receipt, edits))}</span>
                  </button>

                  {expanded && (
                    <div className="ld-receipt__body">
                      {lines.map((line) => {
                        const draft = drafts[line.id] ?? draftOf(line)
                        return (
                          <div className="ld-edit" key={line.id}>
                            <input
                              className="ld-edit__item"
                              value={draft.item}
                              aria-label="Item"
                              onChange={(e) => setDraft(line.id, { item: e.target.value })}
                            />
                            <div className="ld-edit__row">
                              <select
                                className="ld-edit__field ld-edit__cat"
                                value={draft.category}
                                aria-label="Category"
                                onChange={(e) =>
                                  setDraft(line.id, {
                                    category: e.target.value as GroceryCategory,
                                  })
                                }
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="ld-edit__drop"
                                aria-label={`Remove ${line.item}`}
                                onClick={() => drop(line.id)}
                              >
                                ×
                              </button>
                            </div>

                            <div className="ld-edit__row">
                              <label className="ld-edit__pair">
                                <span>$</span>
                                <input
                                  className="ld-edit__field ld-edit__money"
                                  inputMode="decimal"
                                  value={draft.price}
                                  aria-label="Price"
                                  onChange={(e) => setDraft(line.id, { price: e.target.value })}
                                />
                              </label>
                              <label className="ld-edit__pair">
                                <span>×</span>
                                <input
                                  className="ld-edit__field ld-edit__qty"
                                  inputMode="numeric"
                                  value={draft.qty}
                                  aria-label="Quantity"
                                  onChange={(e) => setDraft(line.id, { qty: e.target.value })}
                                />
                              </label>
                              <label className="ld-edit__pair">
                                <span>lasts</span>
                                <input
                                  className="ld-edit__field ld-edit__qty"
                                  inputMode="decimal"
                                  value={draft.weeks}
                                  placeholder="—"
                                  aria-label="Weeks it lasts"
                                  onChange={(e) => setDraft(line.id, { weeks: e.target.value })}
                                />
                                <span>wk</span>
                              </label>
                            </div>
                          </div>
                        )
                      })}

                      <button type="button" className="ld-keep" onClick={() => keep(receipt)}>
                        KEEP THIS RECEIPT
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {items.length > 0 && (
        <section className="ld-band">
          <div className="ld-section-head">
            <h2 className="ld-section-title">WHAT IT COSTS TO KEEP</h2>
            <div className="ld-section-meta">PER WEEK</div>
          </div>

          <ul className="ld-items">
            {items.map((item) => {
              const expanded = openItem === item.key
              return (
                <li key={item.key} className={`ld-item${expanded ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="ld-item__head"
                    aria-expanded={expanded}
                    onClick={() => setOpenItem(expanded ? null : item.key)}
                  >
                    <span className="ld-item__name">
                      <span className="ld-item__label">{item.item}</span>
                      <span className="ld-item__sub">
                        {dollars(item.lastPrice)} every {weeksLabel(item.weeks)} wk ·{' '}
                        {SAYS[item.weeksSource]}
                      </span>
                    </span>
                    <span className="ld-item__figure">
                      <span className="ld-item__rate">{dollars(item.perWeek)}</span>
                      <span className="ld-item__share">
                        <i style={{ width: `${Math.round(item.share * 100)}%` }} />
                      </span>
                    </span>
                  </button>

                  {expanded && (
                    <div className="ld-item__body">
                      <label className="ld-item__set">
                        <span>Lasts</span>
                        <input
                          className="ld-edit__field ld-edit__qty"
                          inputMode="decimal"
                          value={edits.lifespan[item.key] ?? ''}
                          placeholder={weeksLabel(item.weeks)}
                          aria-label={`Weeks ${item.item} lasts`}
                          onChange={(e) => setLifespan(item.key, e.target.value)}
                        />
                        <span>weeks</span>
                      </label>
                      <p className="ld-item__why">
                        Bought {item.buys} {item.buys === 1 ? 'time' : 'times'}, last on{' '}
                        {shortDate(item.lastAt)}. Set a number and every week it has ever appeared in
                        is recomputed — the charts above included.
                        {item.weeksSource === 'pace' &&
                          ' Right now this is measured from how often you actually rebuy it.'}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {restock.length > 0 && (
        <section className="ld-band">
          <div className="ld-section-head">
            <h2 className="ld-section-title">RUNNING OUT</h2>
            <div className="ld-section-meta">SHOPPING LIST</div>
          </div>
          <ul className="ld-restock">
            {restock.map((r) => (
              <li key={r.key} className="ld-restock__row">
                <span className="ld-restock__name">
                  <span>{r.item}</span>
                  <span className="ld-restock__sub">
                    {dollars(r.lastPrice)} last time · {SAYS[r.weeksSource]}
                  </span>
                </span>
                <span className={`ld-restock__due${r.days < 0 ? ' is-out' : ''}`}>
                  {dueLabel(r.days)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {moves.length > 0 && (
        <section className="ld-band">
          <div className="ld-section-head">
            <h2 className="ld-section-title">PRICE MOVES</h2>
            <div className="ld-section-meta">SINCE LAST TIME</div>
          </div>
          <ul className="ld-moves">
            {moves.map((m) => (
              <li key={m.key} className={`ld-move ld-move--${m.direction}`}>
                <span className="ld-move__name">{m.item}</span>
                <span className="ld-move__from">
                  {dollars(m.before)} → {dollars(m.now)}
                </span>
                <span className="ld-move__pct">
                  {m.percent > 0 ? '+' : ''}
                  {m.percent}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {scannedAt !== null && (
        <footer className="ld-rebuild">
          <span className="ld-rebuild__at">RECEIPTS</span>
          <span className="ld-rebuild__text">
            Read from {pantryRoot} on {shortDate(scannedAt)}. The photos are read on the Mac by the{' '}
            <code>claude</code> command already installed there — no key, nothing per receipt — and
            the originals are filed, never deleted. Corrections you make here stay on this device and
            are applied over the reading; they never change what the receipt said.
          </span>
        </footer>
      )}
    </div>
  )
}

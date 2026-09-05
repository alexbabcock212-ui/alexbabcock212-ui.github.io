/**
 * Bake the receipts file into the app.
 *
 *   npm run scan                    # ~/Desktop/Receipts
 *   RECEIPTS_DIR=… npm run scan
 *   GROCERY_TARGET=180 npm run scan
 *   GROCERIES_PRIVATE=1 npm run scan
 *
 * Same reason as the course scan: a web page cannot read a filesystem, so the
 * receipts are a snapshot taken on the Mac at deploy time. Only what was read
 * is baked in — never a derived figure. Every number on the screen is computed
 * in the browser from these rows, which is what lets a correction made there
 * rewrite the whole history rather than only the weeks since.
 *
 * ── on what this publishes ──────────────────────────────────────────────
 * The bundle is served from a *public* repository, so every item name here is
 * world-readable. That is a shopping list, which is more personal than it
 * sounds. `GROCERIES_PRIVATE=1` keeps the prices and the categories and drops
 * the names — the weekly figure, the trend and the target all still work.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Receipt } from '../src/data/types'
import { DEFAULT_TARGET, NO_EDITS, toGroceries } from '../src/data/groceries'
// @ts-expect-error - plain JS helper alongside this script, deliberately untyped
import { readReceiptsFile } from './lib/receipts.mjs'

const ROOT = resolve(process.env.RECEIPTS_DIR ?? join(homedir(), 'Desktop', 'Receipts'))
const STORE = join(ROOT, 'receipts.tsv')
const OUT = resolve(import.meta.dirname, '..', 'src', 'data', 'groceries.generated.json')
const PRIVATE = process.env.GROCERIES_PRIVATE === '1'

const target = Number(process.env.GROCERY_TARGET) || DEFAULT_TARGET

/** Capitalised, so a redacted row still reads as something — `Produce`. */
const asCategory = (r: Receipt): Receipt => ({
  ...r,
  store: '',
  lines: r.lines.map((l) => ({ ...l, item: l.category[0].toUpperCase() + l.category.slice(1) })),
})

const receipts: Receipt[] = existsSync(STORE) ? (readReceiptsFile(STORE) as Receipt[]) : []

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      scannedAt: Date.now(),
      root: ROOT.replace(homedir(), '~'),
      redacted: PRIVATE,
      target,
      receipts: PRIVATE ? receipts.map(asCategory) : receipts,
    },
    null,
    2,
  )}\n`,
)

/* ── what was found ────────────────────────────────────────────────────── */

if (!existsSync(STORE)) {
  console.log(`No receipts file at ${STORE.replace(homedir(), '~')} — writing an empty list.`)
  console.log('Drop a receipt photo in that folder and run `npm run receipts`.')
} else {
  const lines = receipts.reduce((n, r) => n + r.lines.length, 0)
  const pending = receipts.filter((r) => r.status !== 'kept').length
  const g = toGroceries(receipts, NO_EDITS, Date.now(), target)

  console.log(
    `ok    ${receipts.length} receipts  ${String(lines).padStart(4)} lines  ` +
      `${pending} waiting to be checked`,
  )

  if (g.lines.length > 0) {
    console.log(
      `      this week  $${g.perWeek.toFixed(2)}/wk spread, $${g.cash.toFixed(2)} out  ` +
        `(target $${target})`,
    )
    if (g.restock.length > 0) {
      console.log(`      ${g.restock.length} about to run out, ${g.moves.length} price moves`)
    }
  }
}

console.log(`\n${receipts.length} receipt${receipts.length === 1 ? '' : 's'} → src/data/groceries.generated.json`)
if (!PRIVATE && receipts.length > 0) {
  console.log('Note: these item names ship in a public bundle. GROCERIES_PRIVATE=1 omits them.')
}

/**
 * The receipts as the app sees them, and the corrections made to them.
 *
 * Two halves that never mix. `groceries.generated.json` is what was read off
 * the photos, baked in by `npm run scan` on the Mac — a web page cannot watch a
 * folder any more than it can read one. The corrections are yours, they live in
 * this browser, and they are applied over the top at render time.
 *
 * Keeping them apart is what lets a correction rewrite history: change how long
 * a thing lasts and every week it ever appeared in is recomputed, because no
 * derived figure was ever written down.
 */
import generated from './groceries.generated.json'
import type { Receipt } from './types'
import { DEFAULT_TARGET, type PantryEdits } from './groceries'

interface Scan {
  scannedAt: number
  root: string
  /** Dollars a week being aimed at, set at scan time. */
  target: number
  receipts: Receipt[]
}

const scan = generated as unknown as Scan

/**
 * The receipts as they ship in the bundle.
 *
 * When the scan was run with `GROCERIES_PRIVATE=1` these carry categories where
 * the item names should be, because the bundle is served from a public
 * repository. The real names come from the Worker — see `useReceipts` — and
 * this is what the screen falls back to before they arrive, or when there is no
 * key and no network. Every price, weight and date is real either way, so the
 * weekly figure is right even when the names are not.
 */
export const bakedReceipts: Receipt[] = scan.receipts ?? []
/** Epoch ms, or null when no scan has run yet. */
export const scannedAt: number | null = scan.scannedAt || null
export const pantryRoot: string = scan.root ?? '~/Desktop/Receipts'
export const weeklyTarget: number = scan.target || DEFAULT_TARGET

const KEY = 'life-dashboard:pantry'
/**
 * The last set of named receipts the Worker gave us.
 *
 * Cached for the same reason a fortnight of the dashboard is: the screen should
 * open on a train. It holds item names, so it is the one piece of this app's
 * storage worth thinking about — it is per-origin, per-device, and goes when
 * the browser data does.
 */
const NAMED = 'life-dashboard:pantry-receipts'

const empty = (): PantryEdits => ({ lifespan: {}, lines: {}, dropped: {}, reviewed: {} })

/**
 * Every access is guarded: Safari throws outright on localStorage in private
 * mode, and the render check runs under Node where there is none at all.
 */
export function loadEdits(): PantryEdits {
  const base = empty()
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<PantryEdits>
    return {
      lifespan: parsed.lifespan ?? base.lifespan,
      lines: parsed.lines ?? base.lines,
      dropped: parsed.dropped ?? base.dropped,
      reviewed: parsed.reviewed ?? base.reviewed,
    }
  } catch {
    return base
  }
}

export function saveEdits(edits: PantryEdits): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(edits))
  } catch {
    // Storage full or blocked. The correction still holds for this session.
  }
}

/* ── the named copy ────────────────────────────────────────────────────── */

export function loadNamedReceipts(): Receipt[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(NAMED)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Receipt[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

export function saveNamedReceipts(receipts: Receipt[]): void {
  try {
    globalThis.localStorage?.setItem(NAMED, JSON.stringify(receipts))
  } catch {
    // Private mode, or a full quota. The names are still on screen for this
    // session; next launch simply asks the Worker again.
  }
}

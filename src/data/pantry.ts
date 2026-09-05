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

export const receipts: Receipt[] = scan.receipts ?? []
/** Epoch ms, or null when no scan has run yet. */
export const scannedAt: number | null = scan.scannedAt || null
export const pantryRoot: string = scan.root ?? '~/Desktop/Receipts'
export const weeklyTarget: number = scan.target || DEFAULT_TARGET

const KEY = 'life-dashboard:pantry'

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

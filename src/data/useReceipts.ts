/**
 * The receipts the FOOD screen should draw, and where they came from.
 *
 * Three sources, in the order they become available: what shipped in the bundle
 * (instant, but redacted — the bundle is public), what the Worker gave us last
 * time (instant, named), and what the Worker gives us now (named, current).
 *
 * The screen's whole job is checking a read against what the photo said, and a
 * line that reads `Pantry` cannot be checked. So the names matter enough to ask
 * for them, but not enough to make the screen wait: it draws immediately from
 * whatever is already on the device and swaps in the answer when it lands.
 */
import { useEffect, useState } from 'react'
import { fetchGroceries, isConfigured } from './api'
import { deviceKey } from './deviceKey'
import { bakedReceipts, loadNamedReceipts, saveNamedReceipts } from './pantry'
import type { Receipt } from './types'

/** Where the names on screen came from, so the screen can say so. */
export type ReceiptSource = 'baked' | 'cached' | 'live'

export interface Receipts {
  receipts: Receipt[]
  source: ReceiptSource
  /** Set when the Worker was asked and would not answer. */
  error: string | null
}

export function useReceipts(): Receipts {
  const [state, setState] = useState<Receipts>(() => {
    const cached = loadNamedReceipts()
    return cached
      ? { receipts: cached, source: 'cached', error: null }
      : { receipts: bakedReceipts, source: 'baked', error: null }
  })

  useEffect(() => {
    const key = deviceKey()
    if (!key || !isConfigured()) return

    let live = true
    fetchGroceries(key)
      .then(({ receipts }) => {
        if (!live) return
        // Nothing uploaded yet: keep whatever is on screen rather than
        // replacing real names with an empty list.
        if (receipts.length === 0) return
        saveNamedReceipts(receipts)
        setState({ receipts, source: 'live', error: null })
      })
      .catch((e: unknown) => {
        if (!live) return
        // A failure here costs the names, not the screen — so it is reported
        // beside them rather than in place of them.
        setState((prev) => ({ ...prev, error: e instanceof Error ? e.message : String(e) }))
      })

    return () => {
      live = false
    }
  }, [])

  return state
}

/**
 * Talking to the Worker.
 *
 * One request, one payload, every source in it. Splitting the sources across
 * endpoints would mean three round trips from a phone on campus wifi for a
 * screen that is read in one glance.
 */
import type { Payload } from './payload'

/** Set in `.env`; the deployed Worker's origin. Public — it is not a secret. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

export const isConfigured = () => API_BASE !== ''

export class ApiError extends Error {
  /** True when the device key is missing, wrong, or revoked. */
  needsKey: boolean

  constructor(message: string, needsKey = false) {
    super(message)
    this.name = 'ApiError'
    this.needsKey = needsKey
  }
}

/** Give up rather than hang a morning glance on a stalled network. */
const TIMEOUT_MS = 15_000

export async function fetchPayload(key: string, fresh = false): Promise<Payload> {
  if (!isConfigured()) throw new ApiError('VITE_API_BASE is not set — see README.')
  if (!key) throw new ApiError('This device has no key yet.', true)

  const url = `${API_BASE}/api/dashboard${fresh ? '?fresh=1' : ''}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError'
    throw new ApiError(timedOut ? 'The dashboard service timed out.' : 'Could not reach the dashboard service.')
  }

  if (response.status === 401) {
    throw new ApiError('This device is not authorised. Install the key again.', true)
  }
  if (!response.ok) {
    throw new ApiError(`The dashboard service returned ${response.status}.`)
  }

  return (await response.json()) as Payload
}

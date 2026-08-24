/**
 * The one secret this device holds.
 *
 * There is no Google sign-in in this app any more. The refresh token lives in
 * the Worker; the phone only needs to prove it is allowed to ask. That proof is
 * a single opaque string, stored once and then never asked for again — which is
 * the whole point: no sign-in on load, on refresh, or on pulling newer data.
 *
 * It is installed by opening the site once with `#key=…` on the end of the URL,
 * which is a tap on a link rather than typing a long secret on a phone keyboard.
 * The fragment is stripped immediately afterwards so it does not sit in history,
 * in the app switcher, or in a screenshot.
 */
const KEY = 'life-dashboard:device-key'

function read(): string {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDeviceKey(value: string): void {
  try {
    const trimmed = value.trim()
    if (trimmed) globalThis.localStorage?.setItem(KEY, trimmed)
    else globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Private mode: the app still works for this session, via the value in
    // memory, and asks again next launch.
  }
}

export function clearDeviceKey(): void {
  saveDeviceKey('')
}

/**
 * Take a key out of the URL fragment, if one is there, and remember it.
 *
 * Returns whatever key this device should now use. Safe to call on every load.
 */
export function adoptDeviceKey(): string {
  const hash = globalThis.location?.hash ?? ''
  const match = /[#&]key=([^&]+)/.exec(hash)

  if (match) {
    const value = decodeURIComponent(match[1])
    saveDeviceKey(value)
    // Drop the fragment without adding a history entry.
    try {
      const { pathname, search } = globalThis.location
      globalThis.history?.replaceState(null, '', `${pathname}${search}`)
    } catch {
      // Non-fatal: the key is stored either way.
    }
    return value
  }

  return read()
}

export const hasDeviceKey = () => read() !== ''

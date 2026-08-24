/**
 * Google sign-in, browser-only.
 *
 * Uses Google Identity Services' token model, which is the flow designed for
 * apps with no backend: the client ID is public by design and no client secret
 * exists, so this works on a static host like GitHub Pages.
 *
 * The trade-off, straight from Google's docs: this flow issues **no refresh
 * tokens**. Access tokens last about an hour, after which the user has to
 * re-authorize from a user gesture. `requestToken` must therefore be called
 * from a click handler, never on page load.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'

/**
 * Only what is actually used. Tasks and Gmail scopes get added when those
 * screens are implemented — asking for them now would mean a sterner consent
 * screen (Gmail's readonly scope is "restricted", Calendar's only "sensitive")
 * in exchange for access nothing reads.
 */
export const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'].join(' ')

/** Public by design — Google expects this in client-side source. */
export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

export const isConfigured = () => CLIENT_ID !== ''

export interface Token {
  accessToken: string
  /** Epoch ms. */
  expiresAt: number
}

/* ── GIS types, narrowed to what we use ────────────────────────────────── */

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}

interface Gis {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        callback: (response: TokenResponse) => void
        error_callback?: (error: { type?: string }) => void
      }) => TokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}

declare global {
  interface Window {
    google?: Gis
  }
}

/* ── script loading ────────────────────────────────────────────────────── */

let loading: Promise<Gis> | null = null

function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google)
  if (loading) return loading

  loading = new Promise<Gis>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    const script = existing ?? document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.addEventListener('load', () => {
      const gis = window.google
      if (gis?.accounts?.oauth2) resolve(gis)
      else reject(new Error('Google Identity Services loaded but exposed no oauth2 client'))
    })
    // Offline, or blocked: the caller falls back to whatever is cached.
    script.addEventListener('error', () =>
      reject(new Error('Could not reach Google Identity Services')),
    )
    if (!existing) document.head.append(script)
  })

  // Let a later attempt retry rather than latching the failure forever.
  loading.catch(() => {
    loading = null
  })

  return loading
}

/* ── token storage ─────────────────────────────────────────────────────── */

const KEY = 'life-dashboard:google-token'

/** Treat a token as spent slightly early, so a request can't die mid-flight. */
const SKEW_MS = 60_000

export function storedToken(): Token | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return null
    const token = JSON.parse(raw) as Token
    if (!token?.accessToken || token.expiresAt - SKEW_MS < Date.now()) return null
    return token
  } catch {
    return null
  }
}

function store(token: Token | null): void {
  try {
    if (token) globalThis.localStorage?.setItem(KEY, JSON.stringify(token))
    else globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Blocked storage just means reconnecting more often.
  }
}

/* ── the flow ──────────────────────────────────────────────────────────── */

let client: TokenClient | null = null
let pending: ((result: { token?: Token; error?: Error }) => void) | null = null

/**
 * Ask Google for an access token. **Must be called from a user gesture** —
 * this opens a popup, which browsers block otherwise.
 */
export async function requestToken(): Promise<Token> {
  if (!isConfigured()) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not set — see README')
  }

  const gis = await loadGis()

  client ??= gis.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.error || !response.access_token) {
        pending?.({
          error: new Error(response.error_description ?? response.error ?? 'Authorization failed'),
        })
      } else {
        const token: Token = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
        }
        store(token)
        pending?.({ token })
      }
      pending = null
    },
    error_callback: (error) => {
      pending?.({ error: new Error(error.type ?? 'Authorization was dismissed') })
      pending = null
    },
  })

  return new Promise<Token>((resolve, reject) => {
    pending = ({ token, error }) => (token ? resolve(token) : reject(error))
    // Empty prompt lets Google skip the consent screen when it already can.
    client!.requestAccessToken({ prompt: '' })
  })
}

/** Forget the token locally and tell Google to drop the grant. */
export async function signOut(): Promise<void> {
  const token = storedToken()
  store(null)
  client = null
  if (!token) return
  try {
    const gis = await loadGis()
    gis.accounts.oauth2.revoke(token.accessToken)
  } catch {
    // Local sign-out already happened; revocation is best-effort.
  }
}

/**
 * Everything the Worker needs, all of it set with `wrangler secret put`.
 *
 * None of this may ever reach the browser. The whole point of this Worker is
 * to be the one place a long-lived Google refresh token can live: GitHub Pages
 * is public and static, so a token kept there would be readable by anyone.
 */
export interface Env {
  /** The OAuth "Web application" client, from Google Cloud Console. */
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  /** Minted once by `/auth/start`; this is what makes sign-in a one-time event. */
  GOOGLE_REFRESH_TOKEN: string
  /** The bearer token the phone sends. Anyone holding it can read your data. */
  DASHBOARD_TOKEN: string
  /** Gates `/auth/start`, so a stranger cannot walk your setup flow. */
  SETUP_TOKEN: string
  /** Comma-separated origins allowed to call the API. */
  ALLOWED_ORIGINS: string
}

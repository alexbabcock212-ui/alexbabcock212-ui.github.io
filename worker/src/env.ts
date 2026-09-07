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
  /** Minted once by `npm run setup`; what makes sign-in a one-time event. */
  GOOGLE_REFRESH_TOKEN: string
  /** The bearer token the phone sends. Anyone holding it can read your data. */
  DASHBOARD_TOKEN: string
  /** Comma-separated origins allowed to call the API. */
  ALLOWED_ORIGINS: string
  /** Comma-separated calendar names to skip. Google's own feeds are always
   *  skipped; this is for the ones only you know are noise. */
  CALENDAR_EXCLUDE?: string
  /**
   * The receipts, with the item names on them.
   *
   * They live here rather than in the bundle because the bundle is served from
   * a public repository, and a shopping list is more personal than it sounds.
   * Written by `npm run deploy` on the Mac, read back only by a device holding
   * the key — the same bargain as the calendar names.
   */
  GROCERIES: KVNamespace
}

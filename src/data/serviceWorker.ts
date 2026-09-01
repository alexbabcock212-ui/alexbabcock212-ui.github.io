/**
 * Registering the offline service worker — on the web, and only there.
 *
 * The same bundle ships two ways now: served from GitHub Pages over https, and
 * packaged inside the native iOS app, where the web view serves it from
 * `capacitor://localhost`. A service worker is the whole reason the website
 * works on the subway, and is worse than useless in the app:
 *
 *   - the app's assets are already local, so there is nothing to cache;
 *   - custom schemes are not a secure context, so registration fails anyway;
 *   - and if it ever did register, it would serve its cached copy of the app
 *     in front of the freshly built one — a rebuild that visibly does nothing
 *     is a genuinely hard bug to see, because everything about it looks right.
 *
 * So the protocol decides. `vite.config.ts` sets `injectRegister: null` and
 * hands the decision here rather than registering unconditionally on load.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return

  // Never let the HTTP cache stand between a deploy and the new worker.
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
    // No offline copy this time. The app still works; it just needs a network.
  })
}

import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native iOS shell.
 *
 * This wraps the same `dist/` bundle the website serves — there is no second
 * copy of the app and no native UI. What changes is where the bundle is loaded
 * from (the app package rather than Pages) and therefore its origin, which is
 * `capacitor://localhost` and has to be allowed by the Worker like any other.
 * See ALLOWED_ORIGINS in `worker/wrangler.toml`.
 */
const config: CapacitorConfig = {
  appId: 'com.alexbabcock.lifedashboard',
  appName: 'Life Dashboard',
  webDir: 'dist',

  // The one literal colour outside theme.css and the manifest: the native view
  // behind the web view. It is --bg, so the launch screen, the window and the
  // app all sit on the same ground and nothing flashes white on the way in.
  backgroundColor: '#0d0f13',

  ios: {
    // The app locks the document and scrolls `.ld-scroll` itself — the same
    // thing the `position: fixed` shell does on the web. Leaving the web view's
    // own scrolling on would put a second, outer scroller around it and bring
    // back exactly the bug where the whole app slides out from under the tab
    // bar.
    scrollEnabled: false,

    // The CSS already reads the safe areas through `env(safe-area-inset-*)`,
    // so UIKit must not also inset the view — doing both insets twice and
    // leaves a dead band under the status bar.
    contentInset: 'never',

    backgroundColor: '#0d0f13',
  },
}

export default config

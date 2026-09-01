import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registration is a decision, not a side effect of loading: the same
      // bundle also ships inside the native iOS app, where a service worker is
      // useless at best. See src/data/serviceWorker.ts.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Life Dashboard',
        // iOS truncates home-screen labels around 12 characters.
        short_name: 'Dashboard',
        description: "A morning brief that pulls the day together: lectures, deadlines, coursework, and where the markets stand.",
        // The only literal colours outside src/styles/theme.css: a manifest
        // cannot read CSS custom properties. Both are --bg, so the launch
        // splash matches the ground the app opens onto.
        theme_color: '#0d0f13',
        background_color: '#0d0f13',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // woff2 is NOT in the plugin's default glob — without it the
        // self-hosted fonts would be the one thing missing offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The plugin defaults to navigateFallback: 'index.html', which makes
        // the service worker answer *every* navigation with the app shell.
        // Google has to be able to fetch the consent-screen URLs, and so does
        // anyone tapping the footer links from the installed app, so these two
        // are routed to the real static pages instead.
        navigateFallbackDenylist: [/^\/privacy\//, /^\/terms\//],
      },
    }),
  ],
})

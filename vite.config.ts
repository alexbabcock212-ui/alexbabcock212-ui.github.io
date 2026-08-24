import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Life Dashboard',
        // iOS truncates home-screen labels around 12 characters.
        short_name: 'Dashboard',
        description: "A morning brief that pulls the day together: lectures, deadlines, mail, money.",
        // The only literal colours in the project: a manifest cannot read the
        // design system's CSS custom properties. Both are --color-accent-900,
        // so the launch splash matches the header it opens onto.
        theme_color: '#1d2d3d',
        background_color: '#1d2d3d',
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
      },
    }),
  ],
})

# Life Dashboard

A single-screen morning brief: the day's lectures and blocks, what's due, mail
grouped into things that want a reply, and where the money sits.

Built from the `Life Dashboard v2` Claude Design prototype on the **Industry**
design system, and installable to a phone home screen.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle into dist/
npm run lint
```

## Layout

```
src/
  App.tsx                 tab + completion state, the device frame
  components/             StatusBar, TabBar, Corners (blueprint registration marks)
  views/                  one file per tab: Today, Courses, Due, Mail, Money
  data/
    types.ts              the shapes every view reads
    dashboard.ts          fixture content — the seam for real data
    completion.ts         ticked-off deadlines, persisted per day
  styles/
    industry.css          the design system, near-verbatim from the Design project
    fonts.css             self-hosted Barlow (see below)
    app.css               screen styles, built only from Industry's tokens
icons/                    icon sources (SVG) — see "Icons"
scripts/make-icons.mjs    rasterises them; run manually, output is committed
```

### Design system

`src/styles/industry.css` is a copy of `_ds/industry-.../styles.css` from the
Design project so it can be re-synced wholesale. It carries **one deliberate
deviation**, marked in the file: its `@import` of Google Fonts is removed,
because a CDN font request means the app loses its entire typography the moment
the phone is offline. The same families are self-hosted in `fonts.css` instead.

Everything in `app.css` refers to Industry's tokens (`--color-accent-900`,
`--space-8`, `--shadow-lg`, …) rather than to literal colours, so re-tuning the
system propagates here for free. The only literal hexes in the project are
`theme_color` and `background_color` in the manifest, which cannot read CSS
custom properties.

### Installing it on a phone

The app is a PWA: open the URL, then Share → **Add to Home Screen**. It launches
full-screen with no browser chrome and works with no signal — the service worker
precaches the bundle *and the fonts*.

Handset-specific handling worth knowing about, since none of it is visible on a
desktop:

- `viewport-fit=cover` in `index.html` is what makes `env(safe-area-inset-*)`
  return real values. Without it, everything below silently does nothing.
- The simulated `6:02 AM · WIFI · 84%` status bar belongs to the desktop bezel
  only. On a narrow screen or in standalone it's swapped for a spacer painted
  behind the device's own status bar (`.ld-safe-top`).
- The tab bar pads itself by `env(safe-area-inset-bottom)` to clear the home
  indicator.
- All `:hover` rules sit behind `@media (hover: hover)`, or iOS leaves the last
  tapped tab highlighted forever.

### Icons

`icons/icon.svg` is the full mark; `icons/icon-maskable.svg` drops the corner
registration marks because Android's circular mask and iOS's squircle would clip
them. The PNGs in `public/` are generated and committed — `sharp` is not a
dependency, since icons change roughly never. To regenerate:

```bash
npm i -D sharp && node scripts/make-icons.mjs && npm un sharp
```

### Wiring real data

The views never construct content — they read the exports in
`src/data/dashboard.ts`. Swapping the fixtures for live Gmail, Calendar and
Tasks means returning the same shapes from `src/data/types.ts`; no view changes.

Because GitHub Pages is a static host, that split matters: Google's APIs can be
called from the browser with no client secret, but Canvas sends no CORS headers
and no consumer brokerage exposes a browser-callable API. Those two stay fixture
unless a small proxy is added.

## Notes on the port

- The prototype's hard-coded segment widths for *Where the 16 hours go* are
  computed from each segment's hours instead, so the bar and its legend can't
  drift apart.
- Ticked-off deadlines persist across launches, scoped to the day — the brief is
  rebuilt each morning, so yesterday's ticks don't carry into it.
- Tab switches reset the scroll position; each tab is its own screen.

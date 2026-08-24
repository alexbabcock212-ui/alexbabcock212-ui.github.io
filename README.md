# Life Dashboard

A single-screen morning brief: the day's lectures and blocks, what's due, mail
grouped into things that want a reply, and where the money sits.

**No source is connected yet.** Every screen renders an honest empty state
naming what it's waiting on. Nothing on screen is invented — the only live
values are the ones the clock alone can answer (date, greeting, time).

Built from the `Life Dashboard v2` Claude Design prototype on the **Industry**
design system, and installable to a phone home screen.

**Live:** https://alexbabcock212-ui.github.io/

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle into dist/
npm run lint
npm run deploy   # build, then publish to the gh-pages branch
```

## Deploying

GitHub Pages serves the **`gh-pages`** branch, which holds only build output;
`main` holds only source. `npm run deploy` builds and force-pushes the one to
the other, and Pages rebuilds itself within about half a minute.

There is no CI workflow, because publishing one needs a `workflow` scope this
repo's token doesn't carry. To switch to push-to-deploy instead, run
`gh auth refresh -s workflow` and add a standard Pages Actions workflow.

## Layout

```
src/
  App.tsx                 tab + completion state, the device frame
  components/             StatusBar, TabBar, Corners (blueprint registration marks)
  views/                  one file per tab: Today, Courses, Due, Mail, Money
  data/
    types.ts              the shapes every view reads
    dashboard.ts          the dataset + clock-derived values — the seam for real data
    completion.ts         ticked-off deadlines, persisted per day
  styles/
    industry.css          the design system, near-verbatim from the Design project
    fonts.css             self-hosted Barlow (see below)
    app.css               screen styles, built only from Industry's tokens
icons/                    icon sources (SVG) — see "Icons"
scripts/make-icons.mjs    rasterises them; run manually, output is committed
scripts/deploy.sh         build + publish to the gh-pages branch
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

The views never construct content — they read the single `dashboard` object in
`src/data/dashboard.ts`, typed by `Dashboard` in `src/data/types.ts`. Every
collection on it starts empty and every source reports `not-connected`.

Connecting a source means two things and nothing else: set its `SourceState` to
`'ready'`, and fill its collections with the existing shapes. Views already
branch on both, so no view changes.

What each source can and can't do here matters, because GitHub Pages is a static
host with no server and nowhere to keep a secret:

| Source | Reachable? | Notes |
| --- | --- | --- |
| Google Calendar / Tasks / Gmail | yes | Browser-only OAuth, no client secret |
| Weather | yes | Open-Meteo needs no key and allows browser calls |
| Canvas | no | Sends no `Access-Control-Allow-Origin`; browsers refuse outright |
| Brokerage | no | No browser-callable API; Plaid needs a server-side secret |

Money is therefore entered by hand and kept on the device. Canvas would need a
small proxy (a Cloudflare Worker alongside this site) to be reachable at all.

## Notes on the port

- The prototype's content was a different person's life — a Georgia Tech CS
  student. It's been removed rather than retuned: an app that presents invented
  data as yours is worse than one that shows nothing.
- The prototype's hard-coded segment widths for *Where the 16 hours go* are
  computed from each segment's hours instead, so the bar and its legend can't
  drift apart.
- Ticked-off deadlines persist across launches, scoped to the day — the brief is
  rebuilt each morning, so yesterday's ticks don't carry into it.
- Tab switches reset the scroll position; each tab is its own screen.

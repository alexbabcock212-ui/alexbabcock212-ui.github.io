# Life Dashboard

A single-screen morning brief: the day's lectures and blocks hour by hour,
what's due, unread mail grouped by sender, and the course materials sitting on
your Desktop.

**Live:** https://alexbabcock212-ui.github.io/

Built from the `Life Dashboard v2` Claude Design prototype on the **Industry**
design system, and installable to a phone home screen.

## How it fits together

```
  iPhone (PWA, GitHub Pages)          Cloudflare Worker             Google
  ─────────────────────────           ─────────────────             ──────
  device key in localStorage  ──────▶ holds the refresh token ────▶ Calendar
  fortnight of data cached            fetches all three feeds       Tasks
  shapes it into the screens          returns one JSON payload      Gmail
           ▲
           │  baked in at deploy time
     ~/Desktop/Courses  (npm run scan)
```

Three things are worth understanding before changing any of it.

**Why there is a back end at all.** Google's browser-only token flow issues *no
refresh token* by design — access tokens last about an hour and renewing one
needs a tap. That is unfixable in the browser. The Worker exists solely to be a
place where a client secret and a long-lived refresh token can live, which turns
signing in to Google into something that happened once, in the past.

**What the phone holds.** One opaque device key, installed once by opening the
site with `#key=…` on the end of the URL. It is stored in `localStorage` and
never asked for again. There is no Google sign-in in the app.

**Why the Desktop scan is separate.** A web page cannot read a filesystem, and
the Worker runs in a datacentre. So course materials are scanned on the Mac at
deploy time and baked into the bundle — a snapshot, and the Courses screen says
so and dates it.

## Setting it up

Two things in the Google Console, then one command.

### 1. Google Cloud Console (project `360086150959`)

1. **Enable APIs:** Calendar, Tasks, Gmail.
2. **Add scopes** on the consent screen: `calendar.readonly`, `tasks.readonly`,
   `gmail.readonly`.
3. **Publishing status → "In production."** In *Testing*, Google expires refresh
   tokens after **7 days**, which restores the weekly sign-in this whole design
   exists to remove. Unverified-in-production is correct here; it costs one
   "unverified app" interstitial during consent.
4. **Authorized redirect URI** on the Web application client, exactly:
   `http://localhost:8976/callback`
5. On that same client, keep **exactly one** client secret. More than one is how
   you end up copying a secret the Worker does not hold.

### 2. `npm run setup`

```bash
cd worker && npx wrangler login && npx wrangler deploy && cd ..
npm run setup
```

It asks for the client ID and the client secret — the secret at a hidden prompt —
and does everything else: verifies both against Google *before* opening a
browser, runs consent over a loopback socket, exchanges the code in-process,
checks the resulting token can actually read all three APIs, stores four secrets
in the Worker, writes `VITE_API_BASE`, and finishes with a live end-to-end call.

Then:

```bash
npm run deploy
open "$(grep ^PHONE_URL .secrets.local | cut -d= -f2-)"
```

Open that URL once on the phone, then Share → **Add to Home Screen**. That is the
last time anything asks you for anything.

### When it breaks

```bash
npm run doctor
```

Read-only. Checks the local config, the Worker, the device key and each Google
feed, and names the one action that fixes what it found. Run it before anything
else.

### Why setup works this way

Doing it by hand failed six times in a row: a client secret stored as a secret
*name* (twice — `wrangler secret put <value>` is silently valid), a clipboard
clobbered by the very command that read it, a setup token echoed by a dropped
shell quote, a refresh token pasted into a chat window because the callback page
rendered it as plain prose, and a Console change that silently invalidated a step
which had already passed.

Two properties fix that class of problem, and `scripts/setup.mjs` is built around
them:

- **No credential is displayed, retyped, or moved between windows.** The
  authorization code arrives on a loopback socket, the exchange happens in
  process, and the refresh token goes straight to `wrangler secret put`.
- **Every step proves itself before the next one runs.** The important one is
  `probeCredentials` in `scripts/lib/setup-lib.mjs`: it posts a junk
  authorization code to Google, which validates the *client* before it looks at
  the code. `invalid_client` means the secret is wrong; `invalid_grant` means the
  credentials are good; `redirect_uri_mismatch` means step 1.4 was skipped. It
  consumes nothing, needs no consent, and can be repeated at will.

The Worker deliberately has no authorization endpoints. It had them, and that is
where the leaked refresh token came from.

## The 6:45 rule

The brief is meant to be *correct when you read it in the morning*, which is a
slightly different promise from "fetched at 06:45:00". Two mechanisms:

- If the app is open or backgrounded at 6:45, a timer fires and it refetches.
- However you arrive at it later — cold launch, app switcher, tab focus —
  anything last read *before* today's 6:45 counts as stale and is refetched
  before you see it. During the day a read older than ten minutes is refreshed
  the same way, and `Refresh now` in the Today footer forces one.

**The honest limit:** iOS gives a home-screen web app no way to wake itself
while it is closed — Safari supports neither Periodic Background Sync nor
Background Fetch. Nothing runs at 6:45 on a locked phone. What is guaranteed is
that the first look of the day is never yesterday's data, and the fetch takes
about a second.

Both boundaries live in `src/data/morning.ts` and are covered by `npm run check`.

## Courses

### Where a course comes from

Two independent sources, either of which is enough:

- **A calendar named for the course.** On this account each course has its own
  Google calendar — `Econ 2122`, `Mos 2310` — and that is a far better signal
  than reading event titles: a lecture called "Midterm review" on the Econ 2122
  calendar is unambiguously Econ 2122. `courseOf` in
  `src/data/sources/calendar.ts` takes the calendar name first and falls back to
  the title, which still covers a class sitting on a personal calendar.
- **A folder in `~/Desktop/Courses`,** named the same way. This is what fills the
  Courses screen before term starts, when the calendar has nothing to say.

Which calendars get read is a **denylist**, `CALENDAR_EXCLUDE` in
`worker/wrangler.toml` — so next term's sixth course needs no configuration.
Google's holiday and birthday feeds are always skipped.

### Lecture topics

Each course folder can hold a `lectures.tsv`:

```
1	Introduction
2	The Economic Problem
3	Demand and Supply
```

`npm run scan` writes one for you when it can. It looks for a course outline
PDF, extracts the text, and parses the week-by-week schedule table that almost
every syllabus has. On a real outline this got all thirteen weeks, correctly
skipping the midterm and reading-week rows.

**The file always wins on later scans.** That is the whole safety mechanism:
syllabus layouts vary far too much to trust a parser outright, so the parse is
only ever a *draft* written once for a human to correct. Fix a bad row and it
stays fixed. Delete the file to let the parser try again.

Topics are keyed by **week number, not date**, deliberately — a syllabus is often
last year's, so the topics are right while the dates are a year out.

### Term dates

`~/Desktop/Courses/term.json` answers "which week is it", which nothing else can:

```json
{ "start": "2026-09-05", "end": "2026-12-05" }
```

The scan writes a guess from the syllabus's own first date, with the current year
substituted. **Check it** — the whole Courses screen is off by however many weeks
this is wrong.

### Layout

```
~/Desktop/Courses/
  term.json
  Econ 2122/
    lectures.tsv          <- topics, editable, wins over any parse
    Course Info/          <- outline and syllabus first
    Week 1/  Week 2/  Midterms/  Final/
```

Subfolders become sections, ordered the way a term runs. Anything deeper is
flattened into its top-level section; loose files show under LOOSE.

```bash
npm run scan                      # ~/Desktop/Courses
COURSES_DIR=… npm run scan        # somewhere else
COURSES_PRIVATE=1 npm run scan    # sections and counts, no filenames
```

## What is public and what is not

The Pages repo is public, and that shaped several decisions:

| Thing | Where it lives | Public? |
| --- | --- | --- |
| Google refresh token, client secret | Worker secrets | no |
| Calendar, task and mail content | fetched per request, cached on device | no |
| Device key | your phone's `localStorage` | no |
| Worker URL (`VITE_API_BASE`) | the bundle | yes — an address, not a credential |
| **Course filenames and lecture topics** | the bundle, via `courses.generated.json` | **yes** |

That last row is the one to decide about. File *contents* never leave the Mac,
but the names of everything in your course folders ship in a world-readable
bundle. `COURSES_PRIVATE=1 npm run scan` records section names and file counts
only, which the Courses screen renders as a row of section chips instead of a
file list.

To rotate anything — the device key, the client secret, the refresh token — run
`npm run setup` again. It reuses the existing device key unless `.secrets.local`
is missing, so the phone keeps working.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle into dist/
npm run lint
npm run setup    # credentials: Google -> Worker, verified end to end
npm run doctor   # read-only diagnosis when something breaks
npm run check    # data-shaping checks, then an SSR render of every tab
npm run scan     # read ~/Desktop/Courses into the bundle
npm run deploy   # scan, build, publish to the gh-pages branch
```

`npm run check` is the only automated verification there is — there is no
browser in this environment. It covers course-code parsing, the timeline and
hour allocation, folder-to-calendar matching, section ordering, due-date
handling (including the timezone trap below), mail clustering, and the 6:45
boundaries; then it renders all four tabs and the setup sheet to a string.

## Deploying

GitHub Pages serves the **`gh-pages`** branch, which holds only build output;
`main` holds only source. `npm run deploy` scans the Desktop, builds, and
force-pushes the one to the other; Pages rebuilds itself within about half a
minute. It refuses to run if `VITE_API_BASE` is empty, since that failure would
otherwise only surface on the phone.

The Worker deploys separately, and only when `worker/` changes:

```bash
cd worker && npx wrangler deploy
```

There is no CI workflow, because publishing one needs a `workflow` scope this
repo's token doesn't carry. To switch to push-to-deploy, run
`gh auth refresh -s workflow` and add a standard Pages Actions workflow.

## Layout

```
src/
  App.tsx                 tab + completion state, the device frame, the setup sheet
  components/             StatusBar, TabBar, KeyGate, Corners, EmptyState
  views/                  one file per tab: Today, Courses, Due, Mail
  data/
    types.ts              the shapes every view reads
    payload.ts            the wire format between Worker and app
    api.ts                the single call to the Worker
    deviceKey.ts          the one secret this device holds
    cache.ts              last payload, kept for a fortnight
    morning.ts            the 6:45 rule
    useDashboard.ts       fetch, cache, refresh policy, shaping into Dashboard
    courses.ts            the baked Desktop scan
    courses.generated.json    written by `npm run scan` — do not edit
    completion.ts         ticked-off deadlines, persisted per day
    sources/              raw Google shapes → the views' shapes
      calendar.ts           course identity, timeline, hour allocation
      tasks.ts              tasks + all-day events → deadlines
      mail.ts               unread mail → sender clusters
      courses.ts            calendar × Desktop folders → the course list
      term.ts               which week of term it is
  styles/
    industry.css          the design system, near-verbatim from the Design project
    fonts.css             self-hosted Barlow (see below)
    app.css               screen styles, built only from Industry's tokens
worker/
  src/index.ts            two routes: /api/dashboard and /health. Nothing else.
  src/google.ts           token refresh and the three feeds
  wrangler.toml           name and allowed origins; everything else is a secret
scripts/
  setup.mjs               the whole credential flow, verified at every step
  doctor.mjs              read-only diagnosis of the credential chain
  lib/setup-lib.mjs       shared by both, including the Google probe
  scan-courses.ts         the Desktop scan
  lib/syllabus.mjs        PDF text → a week-by-week schedule
  check.ts                data-shaping checks
  render.tsx              SSR render of every tab
  deploy.sh               scan + build + publish to gh-pages
  make-icons.mjs          rasterises the icon sources; run manually
```

### Design system

`src/styles/industry.css` is a copy of `_ds/industry-.../styles.css` from the
Design project so it can be re-synced wholesale. It carries **one deliberate
deviation**, marked in the file: its `@import` of Google Fonts is removed,
because a CDN font request means the app loses its entire typography the moment
the phone is offline. The same families are self-hosted in `fonts.css` instead.

Everything in `app.css` refers to Industry's tokens (`--color-accent-900`,
`--space-8`, `--shadow-lg`, …) rather than to literal colours. The only literal
hexes in the project are `theme_color` and `background_color` in the manifest,
which cannot read CSS custom properties.

### Installing it on a phone

The app is a PWA: open the URL, then Share → **Add to Home Screen**. It launches
full-screen with no browser chrome, and the last fortnight of data opens with no
signal — the service worker precaches the bundle *and the fonts*.

Handset-specific handling worth knowing about, since none of it is visible on a
desktop:

- `viewport-fit=cover` in `index.html` is what makes `env(safe-area-inset-*)`
  return real values. Without it, everything below silently does nothing.
- The simulated status bar belongs to the desktop bezel only. On a narrow screen
  or in standalone it's swapped for a spacer painted behind the device's own
  status bar (`.ld-safe-top`).
- The tab bar pads itself by `env(safe-area-inset-bottom)` to clear the home
  indicator.
- All `:hover` rules sit behind `@media (hover: hover)`, or iOS leaves the last
  tapped tab highlighted forever.
- The device-key field is `font-size: 16px` exactly, or iOS zooms the whole
  frame when it takes focus.

### Icons

`icons/icon.svg` is the full mark; `icons/icon-maskable.svg` drops the corner
registration marks because Android's circular mask and iOS's squircle would clip
them. The PNGs in `public/` are generated and committed — `sharp` is not a
dependency, since icons change roughly never. To regenerate:

```bash
npm i -D sharp && node scripts/make-icons.mjs && npm un sharp
```

## Decisions worth knowing

- **Nothing is invented.** Where a source cannot know something the field stays
  empty and the view hides it rather than drawing a plausible-looking bar.
  `progress` is always 0 for this reason; a syllabus gap produces no topic rather
  than a guessed one; and a schedule row without a week number — a midterm, a
  reading week — is skipped rather than assigned one, because inventing a number
  there would misalign every week after it.
- **The hour bar only counts hours the day has.** Events are clipped to the
  08:00–24:00 window before being summed, so a 07:45 alarm contributes nothing
  and a block running past midnight is credited only the part inside. Counting
  whole durations against a 16-hour window let the segments and the "unclaimed"
  remainder describe different days.
- **Mail is not judged.** The design has a notion of a thread that "wants a
  reply", and no amount of Gmail *metadata* can tell you that; reading bodies to
  guess would be both a larger permission and a worse answer. So the screen
  emphasises what is checkable — mail that arrived today — and tags a cluster
  with a course code when the subject line supplies one.
- **All-day calendar entries are deadlines, not blocks.** They have no place on
  an hour-by-hour timeline and no duration to count toward the day, but they are
  how most due dates actually arrive, so they are folded into the DUE screen
  beside Google Tasks.
- **Dates are parsed as local, deliberately.** `new Date('2026-09-03')` is UTC
  midnight, which is the *2nd* of September in Toronto. Google Tasks and all-day
  events both hand over bare calendar dates, so `localDate` splits the parts and
  uses the local constructor. There is a check pinning this.
- **One source failing does not blank the board.** The Worker returns each feed
  with its own `ok`, and the app shows a note beside the footer rather than an
  error screen when, say, Gmail is down but the timetable is not.
- **The cache is the opening screen.** The app renders the last payload
  immediately and corrects it over the network, rather than showing a spinner.
- Ticked-off deadlines persist across launches, scoped to the day.
- Tab switches reset the scroll position; each tab is its own screen.
- The money screen was removed: no brokerage exposes an API a browser can call,
  so it could only ever have been hand-entered, which is a worse spreadsheet.

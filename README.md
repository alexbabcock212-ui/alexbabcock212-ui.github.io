# Life Dashboard

A single-screen morning brief: the day's lectures and blocks hour by hour,
what's due, the course materials sitting on your Desktop, and where the North
American markets stand.

**Live:** https://alexbabcock212-ui.github.io/

Built from the `Life Dashboard v2` Claude Design prototype on the **Industry**
design system, and installable to a phone home screen.

## How it fits together

```
  iPhone (PWA, GitHub Pages)          Cloudflare Worker             Google
  ─────────────────────────           ─────────────────             ──────
  device key in localStorage  ──────▶ holds the refresh token ────▶ Calendar
  fortnight of data cached            fetches every feed            Tasks
  shapes it into the screens          returns one JSON payload
           ▲                                   │              public feeds
           │  baked in at deploy time          │              ────────────
     ~/Desktop/Courses  (npm run scan)         └────────────▶ quotes
                                                              CNBC + CBC RSS
```

Four things are worth understanding before changing any of it.

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

**Why the market feeds go through the Worker too.** They need no credential —
they are public quote and RSS endpoints — but none of those hosts send CORS
headers, so a browser cannot read them at all. They ride along in the same
payload, behind the same two-minute cache, which also keeps the phone from
parsing three RSS documents to show eight headlines.

## Setting it up

Two things in the Google Console, then one command.

### 1. Google Cloud Console (project `360086150959`)

1. **Enable APIs:** Calendar and Tasks.
2. **Add scopes** on the consent screen: `calendar.readonly` and
   `tasks.readonly`. (`gmail.readonly` was needed by an earlier version and is
   no longer requested — if a previous consent granted it, revoke it at
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
   and re-run `npm run setup`.)
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

### Lecture topics and summaries

Each course folder holds a `lectures.tsv`, four tab-separated columns:

```
1	Introduction	1	Define GDP · Explain why GDP equals aggregate expenditure
2	The Economic Problem	2
```

`npm run scan` writes it. Two sources fill the row, best available winning
**per field**:

1. **What you wrote.** Anything non-empty in the file is never overwritten.
2. **The syllabus row** — topic, dates and chapters from the schedule table.

`detail` is the exception: nothing is ever parsed into it. It is the note *you*
write about a week, and the screen labels it as yours.

#### What each lecture covers

That comes from the decks, and it is re-read from the PDFs on every scan rather
than round-tripped through a file you edit. **Every** deck in a week folder is
read — a week routinely holds two lectures — ordered by the lecture number on
its own title slide.

Each deck is read twice over, best first:

1. **Its own summary slide.** A deck that opens with "Main Points", "Learning
   Objectives", "Outline" or "Agenda" has already answered the question, in the
   lecturer's words. Where a deck has both a *points* and a *questions* slide
   the points win: they are the topics, the questions are about them.
2. **Its slide headings.** One slide is one idea, so the first line of a slide
   is a section title and the sequence of them is the lecture's table of
   contents. A section running over four slides is one topic, not four.

The screen says which of the two it got, because they are different claims
about how closely the summary matches the lecture.

This is why decks are read **page by page** (`extractPages`) while a syllabus is
read whole (`extractText`): in a deck the page *is* the unit of meaning, and
merging destroys the only structure it has.

The deck's real heading is the `Lecture 3: …` line on the title slide, not the
big line above it — that is usually the course name, identical on all twelve
decks and worthless as a lecture title. It wraps, so the continuation is taken
too. `deckScore` picks lecture decks out of a folder that also holds problem
sets and solutions; without it, week 1 of Econ 1022 summarised itself as "The
figure shows the circular flow model", which came from an exercise sheet.

Nothing is ever generated. Every word on the Courses screen came out of a file
in that folder, which is why a week with no deck says exactly that and names
the folder to drop one into, rather than showing a plausible-sounding sentence.

Empty fields fill themselves in as slides appear, and the file is only rewritten
when a scan actually found something new. Delete it to start over from the PDFs.

Topics key on **week number, not date** — a syllabus is often last year's, so the
topics are right while the dates are a year out.

The syllabus's undated rows are kept too: `Midterm 1 — Oct 06`, `Reading Week`.
They are not lectures, so they get no week number; giving them one would
misalign every week after.

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
| Calendar and task content | fetched per request, cached on device | no |
| Quotes and headlines | fetched per request, cached on device | they were public to begin with |
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
handling (including the timezone trap below), the market board's formatting and
derived brief, and the 6:45 boundaries; then it renders all four tabs and the
setup sheet to a string.

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
  components/             StatusBar, TabBar, KeyGate, EmptyState, Spark
  views/                  one file per tab: Today, Courses, Due, Markets
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
    sources/              raw upstream shapes → the views' shapes
      calendar.ts           course identity, timeline, hour allocation
      tasks.ts              tasks + all-day events → deadlines
      markets.ts            the board's layout, rounding and derived brief
      courses.ts            calendar × Desktop folders → the course list
      term.ts               which week of term it is
  styles/
    industry.css          the design system, near-verbatim from the Design project
    theme.css             the palette and scale — the only file naming a colour
    fonts.css             self-hosted Barlow (see below)
    app.css               screen styles, built only from theme.css's roles
worker/
  src/index.ts            two routes: /api/dashboard and /health. Nothing else.
  src/feed.ts             the per-source `{ ok, items, error }` contract
  src/google.ts           token refresh and the two Google feeds
  src/markets.ts          the quote board and the newsroom RSS
  wrangler.toml           name and allowed origins; everything else is a secret
scripts/
  setup.mjs               the whole credential flow, verified at every step
  doctor.mjs              read-only diagnosis of the credential chain
  lib/setup-lib.mjs       shared by both, including the Google probe
  scan-courses.ts         the Desktop scan
  lib/syllabus.mjs        PDF text → a schedule, and a deck → its outline
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

Industry is a light, hairline, blueprint system built for documents.
`src/styles/theme.css` is that system tuned for the one thing it is actually
used for — a dark phone screen, read at 6:45 and again after the close. It
defines role tokens (`--bg`, `--bg-raised`, `--line`, `--fg-2`, `--accent`,
`--up`, `--down`, `--r-card`, …) and it is the **only file in `src/` that names
a colour**; `app.css` composes those roles and nothing else. Retuning the app
means retuning `theme.css`.

The remaining literal hexes in the project are `theme_color` and
`background_color` in the manifest and the two icon sources, none of which can
read a CSS custom property. All four are `--bg`.

### The native iOS app

There is a second way to install it: `ios/` is a Capacitor project that wraps
the *same* `dist/` bundle in a `WKWebView`. There is no second copy of the app
and no native UI — the web build is the app.

#### Building it

**On GitHub, which is how it is actually built.** Xcode does not install on this
Mac: it runs a pre-release macOS 27, the App Store's Xcode is 26.6 and gated to
macOS 26.x, and Homebrew refuses to build for the same reason. Nothing to do
with the chip — Xcode is Apple-Silicon native. So `.github/workflows/ios.yml`
builds on GitHub's macOS runners, which are free and uncapped on public repos.
It runs on every push to `main` that touches the app, and on demand:

```bash
gh workflow run ios.yml          # build now
gh run watch                     # follow it
```

Each build lands twice: as a workflow artifact, and as the asset on the rolling
`ios-latest` prerelease — one stable public URL, because downloading an artifact
requires being logged in to GitHub and a phone should not have to be.

**On a Mac with Xcode**, if you ever have one:

```bash
npm run ios          # scan, build, stage into ios/
npm run ios:open     # open the project in Xcode
```

Then **App target → Signing & Capabilities → Team**, set to your Apple ID; pick
the phone and Run.

#### Installing it

The `.ipa` is deliberately **unsigned**. That is the point rather than a
limitation: [AltStore](https://altstore.io) and
[SideStore](https://sidestore.io) re-sign it with your own free Apple ID on the
way onto the phone, and — the part that matters — **refresh it before the
seven-day profile expires**.

Without them a free-signed app is a weekly chore: the icon stays put and tapping
it says "Unable to Verify App" until you plug into a Mac and build again. The
paid Developer Program ($99/yr) would make the profile last a year, but it buys
nothing else here — App Groups and Push Notifications, the two things that would
justify it (a Home Screen widget needs the first), are closed to free accounts
regardless, so the fee would purchase only the absence of the chore. Sideloading
removes the chore for nothing.

Point the sideloader at the `ios-latest` release asset and it will pick up new
builds from the same URL.

Three things about the native build differ from the website, and all three are
load-bearing:

- **Its origin is `capacitor://localhost`**, not the Pages host, so it is a
  different CORS origin and is listed by name in `ALLOWED_ORIGINS`. Without
  that every request fails inside the app while the website carries on working.
- **It has its own storage.** The device key does not carry over from Safari;
  the app opens on the key sheet once. `npm run ios` prints the command to put
  the key on the clipboard without printing the key.
- **No service worker.** Its assets are already local, custom schemes are not a
  secure context, and a worker that did register would serve its cached copy in
  front of a freshly built one — a rebuild that visibly does nothing. See
  `src/data/serviceWorker.ts`; registration is gated on the protocol, which is
  why `vite.config.ts` sets `injectRegister: null`.

The web app is unaffected by any of it and stays deployed.

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

`icons/icon.svg` is the full mark on a rounded ground;
`icons/icon-maskable.svg` is the same mark pulled well inside the safe zone,
because Android's circular mask and iOS's squircle clip roughly a fifth off
each edge. The PNGs in `public/` are generated and committed — `sharp` is not a
dependency, since icons change roughly never. To regenerate:

```bash
npm i -D sharp && node scripts/make-icons.mjs && npm un sharp
```

## Decisions worth knowing

- **A lecture summary is read, never written.** Every topic under a week comes
  out of that week's own slides, in two readings. A deck that opens with a
  "Main Points" or "Learning Objectives" slide has already answered the
  question in the lecturer's own words, and that is used verbatim. Failing
  that, the *headings* are the answer: one slide is one idea, so the first line
  of each slide is a section title and the sequence of them is the lecture's
  table of contents. The screen labels which of the two it got, because they
  are different claims about how well the summary matches the lecture. A deck
  with nothing to say yields an empty list, never a plausible-sounding one.
- **A deck is read page by page; a syllabus is read whole.** `extractText`
  merges the pages, which is right for prose and destroys a deck — in a deck
  the page *is* the unit of meaning. `extractPages` is the one decks use.
- **Every deck in a week is read, not the first.** A week folder routinely
  holds two lectures; this term's Classics folder has "Lecture 1" and
  "Lecture 2" side by side in Week 1. Stopping at the first meant half of
  every week went unread. Decks order by the lecture number on their own title
  slide, which is also where their real heading lives — the big line at the top
  is usually the *course* name and worthless as a lecture title.
- **`detail` in `lectures.tsv` is yours alone.** Nothing is parsed into it. It
  used to receive whatever the objectives slide said, which made a machine
  reading indistinguishable from a written one in a file a human edits, and
  printed the same list twice on the screen. It now holds only what you write,
  and the screen labels it as your note.
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
- **The market brief states, it does not advise.** Every figure on that screen
  is arithmetic on a last price and a previous close, and the sentence at the
  top is assembled from those same rows — a count of how many North American
  indexes rose, then three levels quoted back. There is no adjective the
  arithmetic does not license and no causal claim anywhere: the screen can see
  that the Nasdaq rose, never why. It is a board, in the sense a departures
  board is a board.
- **A yield moves in basis points.** Every other row shows a percent change;
  the 10-year shows `+0.8 bp`, because "the 10-year rose 0.17%" is a percent of
  a percent and means nothing to anyone.
- **The last good board outlives a rate limit.** The quote host throttles
  shared datacentre addresses, so the Worker keeps the last board that actually
  worked for half an hour and serves it when a fresh read fails. That is honest
  here in a way it would not be for a calendar: every row carries the timestamp
  of its own last print and the screen shows it, so a stale board says on its
  face that it is stale. Headlines are never rolled back — only the quotes fall
  back.
- **The `User-Agent` is load-bearing, and was found the hard way.** The quote
  host answers **429** both to a full Chrome string and to a bare `curl/8.x`: a
  client claiming to be a browser is expected to use the website rather than the
  JSON API, and an anonymous one is assumed to be a scraper. The newsroom edge
  wants the opposite and drops anything it cannot recognise as a client at all.
  `Mozilla/5.0 (compatible; life-dashboard/1.0)` satisfies both and is the only
  version of it that is true. Do not "modernise" it into a real browser's UA.
- **Headlines are capped per newsroom, not just merged.** CBC files business
  copy several times an hour and CNBC does not, so sorting a straight merge by
  timestamp produced six CBC headlines and two of everything else. Each feed is
  capped at three first, and the survivors are then sorted.
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
  error screen when, say, the quote feed is down but the timetable is not.
- **The cache is the opening screen.** The app renders the last payload
  immediately and corrects it over the network, rather than showing a spinner.
- Ticked-off deadlines persist across launches, scoped to the day.
- Tab switches reset the scroll position; each tab is its own screen.
- The money screen was removed: no brokerage exposes an API a browser can call,
  so it could only ever have been hand-entered, which is a worse spreadsheet.
  The MARKETS screen is not that screen — it holds no positions and knows
  nothing about you, which is exactly why it can be live.
- **The mail screen was removed, and the Gmail scope with it.** Grouping unread
  senders was the least-read screen in the app and the largest permission it
  asked for. Deleting the screen but keeping the scope would have meant reading
  a mailbox every two minutes to display nothing, so `fetchMail`, the
  `gmail.readonly` scope and the setup probe all went at the same time.

/**
 * Read the receipt photos on the Desktop into `receipts.tsv`.
 *
 *   npm run receipts              # read whatever is waiting, once
 *   npm run receipts -- --watch   # keep watching the folder
 *   npm run receipts -- --deploy  # …and publish after each batch
 *   RECEIPTS_DIR=… npm run receipts
 *
 * Drop a photo in `~/Desktop/Receipts`. It is read, its line items land in
 * `receipts.tsv` marked `pending`, and the photo moves to `Receipts/Filed/`.
 * The original is never deleted — a reading can always be checked against it,
 * and a receipt is the only record of a price that ever existed.
 *
 * A long receipt does not fit in one legible photograph, so a *folder* is also
 * one receipt: every photo in it is read together, in filename order, as a
 * single shop. Photograph a long till roll in two or three overlapping pieces,
 * drop them in a folder, and they arrive as one.
 *
 * ── on how it is read ───────────────────────────────────────────────────
 * By shelling out to the `claude` CLI that is already installed and already
 * signed in. That is the whole reason this needs no API key and costs nothing
 * per receipt: the reading happens under the same account that runs this repo's
 * tooling. Nothing is uploaded anywhere else, and no receipt leaves the Mac
 * except as that one request.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import {
  mergeReceipts,
  parseReaderOutput,
  readReceiptsFile,
  receiptId,
  toReceipt,
  writeReceiptsFile,
} from './lib/receipts.mjs'

const ROOT = resolve(process.env.RECEIPTS_DIR ?? join(homedir(), 'Desktop', 'Receipts'))
const FILED = join(ROOT, 'Filed')
const STORE = join(ROOT, 'receipts.tsv')

/** Sonnet reads a receipt as well as anything and turns it round in seconds. */
const MODEL = process.env.RECEIPT_MODEL ?? 'sonnet'

/**
 * A stuck read must not wedge a watcher that is meant to run all day.
 *
 * A long receipt is a couple of hundred lines of JSON to write out, which takes
 * minutes on a slow afternoon even when nothing is wrong. The cap is there to
 * catch a read that is genuinely never coming back, not to race a slow one.
 */
const TIMEOUT_MS = 300_000

const WATCH = process.argv.includes('--watch')
const DEPLOY = process.argv.includes('--deploy')

const PHOTOS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.heic', '.heif'])
/** Read cannot open an iPhone's native format; `sips` converts it. */
const NEEDS_CONVERTING = new Set(['.heic', '.heif'])
/**
 * The long edge every photo is scaled down to before it is read.
 *
 * A photo off a recent iPhone is 48 megapixels — 8064 x 6048, and about 10MB
 * once it is a JPEG. That is more pixels and more megabytes than the reader
 * accepts, so the read does not come back slowly, it does not come back at all,
 * and the timeout kills it. Anything bigger than this gets downscaled at the
 * other end anyway, so capping it here costs nothing off the receipt and turns
 * a three-minute hang into a read that returns.
 */
const MAX_EDGE = 1568

const RULES = `{"store":string,"date":"YYYY-MM-DD","total":number|null,"currency":string,
 "lines":[{"item":string,"category":string,"qty":number,"price":number,"lifespanWeeks":number|null}]}

Rules:
- price is the total paid for that line after any line discount, in dollars.
- qty is how many units were bought; use 1 when the receipt does not say. For
  something sold by weight, qty is 1.
- category is exactly one of: produce, dairy, meat, bakery, frozen, pantry,
  beverages, snacks, household, personal, other
- lifespanWeeks: how long that quantity typically lasts one person before it has
  to be bought again. Use null rather than guessing wildly.
- Skip subtotals, taxes, totals, deposits, discounts and loyalty lines. Items only.
- Name each item as it is printed, but in ordinary capitalisation and with
  obvious abbreviations expanded: "MLK 2% 4L" is "Milk 2% 4L". The photo is
  kept, so the exact printing is never lost; this list is read by a person.
- If this is not a receipt, return {"lines":[]}.`

/**
 * What to ask, for one photo or for several of the same receipt.
 *
 * The multi-photo wording carries the only two things that can go wrong when a
 * till roll is photographed in pieces: reading them out of order, and counting
 * the overlap twice. Both produce a total that looks entirely plausible.
 */
const promptFor = (paths) =>
  paths.length === 1
    ? `Read the receipt in the image ${basename(paths[0])} and return ONLY a JSON object. No prose, no code fence.

${RULES}`
    : `The ${paths.length} images ${paths.map((p) => basename(p)).join(', ')} are overlapping
photographs of ONE receipt, in order from its top to its bottom. Read them as a
single receipt and return ONLY a JSON object. No prose, no code fence.

${RULES}
- Where two images overlap, list each item once. Do not repeat a line because it
  appears at the bottom of one photo and the top of the next.
- The store and date will be on the first image, the total usually on the last.`

/* ── running the reader ────────────────────────────────────────────────── */

function runClaude(paths, cwd) {
  return new Promise((done) => {
    const child = spawn(
      'claude',
      [
        '-p',
        promptFor(paths),
        '--allowedTools',
        'Read',
        '--output-format',
        'json',
        '--model',
        MODEL,
      ],
      // Run inside the scratch directory holding this receipt's photos, so the
      // reader may open those and nothing else. stdin is closed: with a pipe it
      // waits for input that is never coming.
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    )

    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))

    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)

    child.on('error', (e) => {
      clearTimeout(timer)
      done({ ok: false, why: e.code === 'ENOENT' ? 'the claude CLI is not on PATH' : e.message })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        done({ ok: false, why: err.trim().split('\n').pop() || `claude exited ${code}` })
        return
      }

      // `--output-format json` wraps the answer; the answer itself is a string
      // that should be JSON, and usually is.
      let text = out
      try {
        const envelope = JSON.parse(out)
        if (envelope?.is_error) {
          done({ ok: false, why: String(envelope.result ?? 'the reader reported an error') })
          return
        }
        if (typeof envelope?.result === 'string') text = envelope.result
      } catch {
        // Not the envelope — fall through and read the raw output.
      }

      const parsed = parseReaderOutput(text)
      done(parsed ? { ok: true, raw: parsed } : { ok: false, why: 'no JSON in the reading' })
    })
  })
}

/* ── the folder ────────────────────────────────────────────────────────── */

const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true })

const photosIn = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && !d.name.startsWith('.'))
      .filter((d) => PHOTOS.has(extname(d.name).toLowerCase()))
      .map((d) => d.name)
      .sort(byName)
  } catch {
    return []
  }
}

/**
 * Everything waiting to be read, one job per receipt.
 *
 * A loose photo is a receipt. A folder is *also* a receipt — all of it, in
 * filename order. Numeric-aware sorting, so `2` comes before `10` rather than
 * after it, which is the difference between a receipt read top to bottom and
 * one read in an order nobody intended.
 */
const waiting = () => {
  let entries
  try {
    entries = readdirSync(ROOT, { withFileTypes: true })
  } catch {
    return []
  }

  const jobs = []
  for (const entry of [...entries].sort((a, b) => byName(a.name, b.name))) {
    if (entry.name.startsWith('.')) continue

    if (entry.isDirectory()) {
      // Filed/ is where read photos go; walking into it would offer every
      // receipt ever read a second time.
      if (join(ROOT, entry.name) === FILED) continue
      const parts = photosIn(join(ROOT, entry.name)).map((p) => `${entry.name}/${p}`)
      if (parts.length > 0) jobs.push({ name: entry.name, parts })
      continue
    }

    if (entry.isFile() && PHOTOS.has(extname(entry.name).toLowerCase())) {
      jobs.push({ name: entry.name, parts: [entry.name] })
    }
  }

  return jobs
}

/**
/**
 * This receipt's photos as files the reader can open, in one scratch directory.
 *
 * Everything is copied or converted out of the watched folder rather than being
 * read where it lies. A converted copy written beside the original is a file
 * this tool has never seen before: the original gets filed, the copy stays
 * behind, and the next pass reads it as a second shop — which the check against
 * re-reading cannot catch, because the two names genuinely differ.
 *
 * Every photo goes through sips on the way, not only the iPhone-native ones. A
 * full-size photo of any format is too large to be read at all — see MAX_EDGE —
 * so a JPEG straight off the same camera needs the pass just as much as a HEIC
 * does. That matters more here than it did for a single photo: a folder sends
 * its parts to one read together, so full-size ones blow the limit even sooner.
 * A PDF is not pixels and is copied untouched, and a format sips will not take
 * is copied as it is, which still stands a chance.
 *
 * Numbered on the way in, so the order they are named in the prompt is the
 * order they were taken in.
 */
function prepare(parts) {
  const dir = mkdtempSync(join(tmpdir(), 'receipt-'))
  const paths = []

  for (const part of parts) {
    const from = join(ROOT, part)
    const ext = extname(part).toLowerCase()
    const n = String(paths.length + 1).padStart(2, '0')

    if (ext !== '.pdf') {
      const to = join(dir, `${n}.jpg`)
      const sips = spawnSync('sips', ['-s', 'format', 'jpeg', '-Z', String(MAX_EDGE), from, '--out', to])
      if (sips.status === 0 && existsSync(to)) {
        paths.push(to)
        continue
      }
      // A HEIC that would not convert cannot be read at all. Anything else is
      // still worth handing over as it is.
      if (NEEDS_CONVERTING.has(ext)) continue
    }

    const copy = join(dir, `${n}${ext}`)
    try {
      copyFileSync(from, copy)
    } catch {
      continue
    }
    paths.push(copy)
  }

  return { dir, paths }
}

/** Move a photo or a whole folder into Filed/, never over one already there. */
function file(name) {
  let target = join(FILED, name)
  mkdirSync(FILED, { recursive: true })

  if (existsSync(target)) {
    const stem = basename(name, extname(name))
    const ext = extname(name)
    for (let n = 2; existsSync(target); n++) target = join(FILED, `${stem}-${n}${ext}`)
  }

  try {
    renameSync(join(ROOT, name), target)
  } catch {
    // Left where it is; it will simply be offered again next time.
  }
}

/** The photo's own date, for a receipt whose printed one could not be read. */
function takenOn(part) {
  try {
    const d = new Date(statSync(join(ROOT, part)).mtimeMs)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return null
  }
}

async function readAll(jobs) {
  let receipts = readReceiptsFile(STORE)
  const filed = new Set(receipts.map((r) => r.photo))
  let added = 0

  for (const job of jobs) {
    const label = job.parts.length > 1 ? `${job.name}/ (${job.parts.length} photos)` : job.name

    if (filed.has(job.name)) {
      console.log(`skip  ${label}  (already read)`)
      file(job.name)
      continue
    }

    process.stdout.write(`read  ${label} … `)

    const { dir, paths } = prepare(job.parts)
    if (paths.length === 0) {
      console.log('could not be opened')
      rmSync(dir, { recursive: true, force: true })
      continue
    }

    const result = await runClaude(paths, dir)
    rmSync(dir, { recursive: true, force: true })

    if (!result.ok) {
      console.log(result.why)
      continue
    }

    const taken = new Set(receipts.map((r) => r.id))
    const fallback = takenOn(job.parts[0])
    const date = result.raw?.date ?? fallback
    const id = receiptId(
      String(date ?? '').slice(0, 10) || 'undated',
      result.raw?.store ?? 'shop',
      taken,
    )

    const receipt = toReceipt(result.raw, { id, photo: job.name, fallbackDate: fallback })
    if (!receipt) {
      console.log('nothing on it that looks like groceries')
      continue
    }

    const merged = mergeReceipts(receipts, [receipt])
    receipts = merged.receipts
    added += merged.added.length

    const sum = receipt.lines.reduce((t, l) => t + l.price, 0)
    console.log(
      `${receipt.store}, ${receipt.date} — ${receipt.lines.length} lines, $${sum.toFixed(2)}`,
    )

    // The receipt is in the file before the photos move, so a crash between the
    // two costs a re-read rather than the only copy of a shop.
    writeReceiptsFile(STORE, receipts)
    file(job.name)
  }

  return added
}

/* ── run ───────────────────────────────────────────────────────────────── */

for (const dir of [ROOT, FILED]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * `quiet` is for the watcher, which calls this every time the folder stirs and
 * every 30 seconds regardless. Saying "nothing waiting" there would scroll the
 * one line that matters off the screen; saying it on a one-shot run is the
 * difference between "there was nothing to do" and a script that looks broken.
 */
async function pass(quiet = false) {
  const jobs = waiting()
  if (jobs.length === 0) {
    if (!quiet) {
      console.log(`Nothing waiting in ${ROOT.replace(homedir(), '~')}.`)
      console.log('Drop a receipt photo, or a folder of them, in there and run this again.')
    }
    return 0
  }

  const added = await readAll(jobs)
  if (added === 0) return 0

  const total = readReceiptsFile(STORE).length
  console.log(
    `\n${added} receipt${added === 1 ? '' : 's'} → ${STORE.replace(homedir(), '~')} (${total} in all)`,
  )
  console.log('They are waiting under ADD on the FOOD screen, unchecked.')

  if (DEPLOY) {
    console.log('\nPublishing …\n')
    spawnSync('npm', ['run', 'deploy'], { stdio: 'inherit' })
  } else {
    console.log('Run `npm run deploy` to put them on the phone.')
  }

  return added
}

await pass()

if (WATCH) {
  console.log(`\nWatching ${ROOT.replace(homedir(), '~')} — drop a receipt in. Ctrl-C to stop.`)

  let timer = null
  let running = false

  const nudge = () => {
    // Copying photos in fires several events, and a large one arrives in
    // pieces; wait for the folder to go quiet before reading anything. A folder
    // of photos being dragged in needs this most — half a receipt is worse than
    // none.
    clearTimeout(timer)
    timer = setTimeout(async () => {
      if (running) return
      running = true
      try {
        await pass(true)
      } finally {
        running = false
      }
    }, 2500)
  }

  const { watch } = await import('node:fs')
  watch(ROOT, { recursive: true }, nudge)
  // fs.watch misses things over some network and synced volumes; a slow poll
  // costs nothing and means a photo is never simply forgotten.
  setInterval(nudge, 30_000)
}

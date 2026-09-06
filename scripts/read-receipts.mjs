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
 * ── on how it is read ───────────────────────────────────────────────────
 * By shelling out to the `claude` CLI that is already installed and already
 * signed in. That is the whole reason this needs no API key and costs nothing
 * per receipt: the reading happens under the same account that runs this repo's
 * tooling. Nothing is uploaded anywhere else, and no receipt leaves the Mac
 * except as that one request.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
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

/** A stuck read must not wedge a watcher that is meant to run all day. */
const TIMEOUT_MS = 180_000

const WATCH = process.argv.includes('--watch')
const DEPLOY = process.argv.includes('--deploy')

const PHOTOS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.heic', '.heif'])
/** Read cannot open an iPhone's native format; `sips` converts it in place. */
const NEEDS_CONVERTING = new Set(['.heic', '.heif'])

const PROMPT = `Read the receipt in the image at PATH and return ONLY a JSON object. No prose, no code fence.

{"store":string,"date":"YYYY-MM-DD","total":number|null,"currency":string,
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
- If the image is not a receipt, return {"lines":[]}.`

/* ── running the reader ────────────────────────────────────────────────── */

function runClaude(path) {
  return new Promise((done) => {
    const child = spawn(
      'claude',
      [
        '-p',
        PROMPT.replace('PATH', path),
        '--allowedTools',
        'Read',
        '--output-format',
        'json',
        '--model',
        MODEL,
      ],
      // Run inside whichever folder the file is actually in, so the reader may
      // open that one and nothing else — for a converted iPhone photo that is
      // the scratch directory, not the receipts folder. stdin is closed: with a
      // pipe it waits for input that is never coming.
      { cwd: dirname(path), stdio: ['ignore', 'pipe', 'pipe'] },
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

/**
 * Every photo waiting to be read, named relative to the receipts folder.
 *
 * Subfolders are followed one level, so receipts kept in `Week 3/` are read
 * like any other — a folder of photos sitting there doing nothing is a far
 * worse answer than reading them. Which week a shop belongs to is still taken
 * from the date printed on the receipt, never from the folder it is in: a photo
 * filed in the wrong place still lands in the right week.
 */
const waiting = (dir = ROOT, prefix = '') => {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const out = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const name = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      // Filed/ is where read photos go; walking back into it would offer every
      // receipt ever read a second time.
      if (prefix || join(dir, entry.name) === FILED) continue
      out.push(...waiting(join(dir, entry.name), name))
      continue
    }

    if (entry.isFile() && PHOTOS.has(extname(entry.name).toLowerCase())) out.push(name)
  }

  return out.sort()
}

/**
 * Convert what Read cannot open, leaving the original untouched.
 *
 * The conversion goes to a scratch directory rather than next to the photo. A
 * `.jpg` written beside `IMG_0421.heic` is a file this folder has never seen
 * before: the original gets filed, the copy stays behind, and the next pass
 * reads it as a second shop. The photo-name check that stops a re-read cannot
 * catch it, because the two names genuinely differ — so that week's groceries
 * would quietly double.
 */
function readable(name) {
  const path = join(ROOT, name)
  if (!NEEDS_CONVERTING.has(extname(name).toLowerCase())) return path

  const jpeg = join(tmpdir(), `receipt-${process.pid}-${basename(name).replace(/\.[^.]+$/, '')}.jpg`)
  const sips = spawnSync('sips', ['-s', 'format', 'jpeg', path, '--out', jpeg])
  return sips.status === 0 && existsSync(jpeg) ? jpeg : null
}

/** Move a photo into Filed/, never over the top of one already there. */
function file(name) {
  let target = join(FILED, name)
  // A photo from `Week 3/` is filed under `Filed/Week 3/`, so however the
  // folder was arranged going in, it is still arranged coming out.
  mkdirSync(dirname(target), { recursive: true })
  if (existsSync(target)) {
    const stem = name.replace(/\.[^.]+$/, '')
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
function takenOn(name) {
  try {
    const d = new Date(statSync(join(ROOT, name)).mtimeMs)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return null
  }
}

async function readAll(names) {
  let receipts = readReceiptsFile(STORE)
  const filed = new Set(receipts.map((r) => r.photo))
  let added = 0

  for (const name of names) {
    if (filed.has(name)) {
      console.log(`skip  ${name}  (already read)`)
      file(name)
      continue
    }

    process.stdout.write(`read  ${name} … `)

    const path = readable(name)
    if (!path) {
      console.log('could not be converted')
      continue
    }

    const result = await runClaude(path)
    if (!result.ok) {
      console.log(result.why)
      continue
    }

    const taken = new Set(receipts.map((r) => r.id))
    const date = result.raw?.date ?? takenOn(name)
    const id = receiptId(
      String(date ?? '').slice(0, 10) || 'undated',
      result.raw?.store ?? 'shop',
      taken,
    )

    const receipt = toReceipt(result.raw, { id, photo: name, fallbackDate: takenOn(name) })
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

    // The receipt is in the file before the photo moves, so a crash between the
    // two costs a re-read rather than the only copy of a shop.
    writeReceiptsFile(STORE, receipts)
    file(name)
  }

  return added
}

/* ── run ───────────────────────────────────────────────────────────────── */

for (const dir of [ROOT, FILED]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

async function pass() {
  const names = waiting()
  if (names.length === 0) return 0

  const added = await readAll(names)
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
    // Copying a photo in fires several events, and a large one arrives in
    // pieces; wait for the folder to go quiet before reading anything.
    clearTimeout(timer)
    timer = setTimeout(async () => {
      if (running) return
      running = true
      try {
        await pass()
      } finally {
        running = false
      }
    }, 1500)
  }

  const { watch } = await import('node:fs')
  watch(ROOT, nudge)
  // fs.watch misses things over some network and synced volumes; a slow poll
  // costs nothing and means a photo is never simply forgotten.
  setInterval(nudge, 30_000)
}

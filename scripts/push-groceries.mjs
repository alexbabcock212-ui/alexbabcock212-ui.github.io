/**
 * Put the receipts, with their item names, in the Worker's KV.
 *
 *   npm run groceries:push
 *   RECEIPTS_DIR=… npm run groceries:push
 *
 * The bundle that GitHub Pages serves is public, so `npm run scan` redacts the
 * item names out of it — categories where the names should be. This is where
 * the names go instead: a namespace only the Worker reads, behind the same
 * device key as everything else. The phone asks for them on the FOOD screen.
 *
 * Nothing derived is uploaded, for the same reason nothing derived is baked in:
 * every figure on the screen is computed in the browser from these rows, which
 * is what lets a correction there rewrite the whole history rather than only
 * the weeks since.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readReceiptsFile } from './lib/receipts.mjs'

const ROOT = resolve(process.env.RECEIPTS_DIR ?? join(homedir(), 'Desktop', 'Receipts'))
const STORE = join(ROOT, 'receipts.tsv')
const WORKER = resolve(import.meta.dirname, '..', 'worker')

const receipts = readReceiptsFile(STORE)

if (receipts.length === 0) {
  console.log(`No receipts at ${STORE.replace(homedir(), '~')} — nothing to push.`)
  process.exit(0)
}

// Written to a scratch file rather than passed as an argument: item names have
// no business in a process list, and a long shop would outrun the limit anyway.
const dir = mkdtempSync(join(tmpdir(), 'groceries-'))
const payload = join(dir, 'receipts.json')

try {
  writeFileSync(payload, JSON.stringify({ receipts, uploadedAt: Date.now() }))

  const put = spawnSync(
    'npx',
    ['wrangler', 'kv', 'key', 'put', 'receipts', '--path', payload, '--binding', 'GROCERIES', '--remote'],
    { cwd: WORKER, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  if (put.status !== 0) {
    console.error(String(put.stderr || put.stdout).trim() || 'wrangler would not write the key')
    process.exit(1)
  }

  const lines = receipts.reduce((n, r) => n + r.lines.length, 0)
  console.log(`ok    ${receipts.length} receipts, ${lines} named lines → GROCERIES/receipts`)
} finally {
  // The one copy of the names outside the Desktop folder; it does not outlive
  // the upload.
  rmSync(dir, { recursive: true, force: true })
}

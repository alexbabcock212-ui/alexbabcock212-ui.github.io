#!/usr/bin/env node
/**
 * Diagnose the credential chain without changing anything.
 *
 * Worker secrets cannot be read back — by design — so this checks the chain
 * through its behaviour instead, which is the honest level anyway: the question
 * is never "is a secret present" but "does the whole path work". Each failure
 * is matched to the one thing that fixes it.
 *
 * Run this first whenever the dashboard goes blank.
 *
 *   npm run doctor
 */
import { resolve } from 'node:path'
import {
  bad,
  head,
  note,
  ok,
  readEnvFile,
  workerDashboard,
  workerHealth,
} from './lib/setup-lib.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const ENV = resolve(ROOT, '.env')
const SECRETS = resolve(ROOT, '.secrets.local')

/** Map a feed's error text to the single action that resolves it. */
function remedy(error = '') {
  const e = error.toLowerCase()
  if (e.includes('client secret')) {
    return [
      'The stored client secret does not match an active one on the OAuth client.',
      'Fix: delete every secret but one in the Console, then npm run setup.',
    ]
  }
  if (e.includes('invalid_grant') || e.includes('refresh token')) {
    return [
      'The refresh token was revoked or expired.',
      'If it expired after ~7 days, the consent screen is still in Testing —',
      'set publishing status to In production, then npm run setup.',
    ]
  }
  if (e.includes('403') || e.includes('has not been used') || e.includes('disabled')) {
    return [
      'That Google API is not enabled on the project.',
      'Enable Calendar and Tasks in the API Library, then retry.',
    ]
  }
  if (e.includes('insufficient') || e.includes('scope')) {
    return ['The token lacks that scope. Add it on the consent screen, then npm run setup.']
  }
  return ['No known remedy for this one — the raw error above is the best lead.']
}

async function main() {
  console.log('\nLife Dashboard doctor')

  head('Local configuration')

  const env = readEnvFile(ENV)
  const base = (env.VITE_API_BASE ?? '').replace(/\/+$/, '')
  if (base) ok('VITE_API_BASE', base)
  else {
    bad('VITE_API_BASE is not set in .env')
    note('Run npm run setup.')
    process.exit(1)
  }

  const secrets = readEnvFile(SECRETS)
  const deviceKey = secrets.DASHBOARD_TOKEN ?? ''
  if (deviceKey) ok('DASHBOARD_TOKEN present in .secrets.local', `${deviceKey.length} chars`)
  else {
    bad('No DASHBOARD_TOKEN in .secrets.local')
    note('Run npm run setup.')
    process.exit(1)
  }

  head('Worker')

  if (await workerHealth(base)) ok('/health answers')
  else {
    bad('/health did not answer')
    note('cd worker && npx wrangler deploy')
    process.exit(1)
  }

  // A Worker that answers unauthenticated requests would be serving a private
  // calendar to the open internet, so this is a real check, not a formality.
  const unauth = await fetch(`${base}/api/dashboard`).then(
    (r) => r.status,
    () => 0,
  )
  if (unauth === 401) ok('/api/dashboard rejects unauthenticated requests', '401')
  else bad('/api/dashboard did NOT return 401 without a key', `got ${unauth}`)

  head('Google, through the Worker')

  let payload
  try {
    payload = await workerDashboard(base, deviceKey)
  } catch (e) {
    bad(`The Worker call failed: ${e.message}`)
    if (String(e.message).startsWith('401')) {
      note('The device key in .secrets.local is not the one the Worker holds.')
      note('Run npm run setup to reconcile them.')
    }
    process.exit(1)
  }

  const failures = []
  for (const feed of ['calendar', 'allDay', 'tasks', 'quotes', 'headlines']) {
    const f = payload[feed] ?? {}
    const n = (f.items ?? []).length
    if (f.ok) ok(feed, `${n} item${n === 1 ? '' : 's'}`)
    else {
      bad(feed, f.error ?? 'unknown error')
      failures.push(f.error ?? '')
    }
  }

  if (payload.fetchedAt) {
    const age = Math.round((Date.now() - payload.fetchedAt) / 1000)
    note(`payload fetched ${age}s ago`)
  }

  if (failures.length === 0) {
    head('Healthy')
    note('Every source reads. If the phone still looks wrong, it is the app or the')
    note('cache, not the credentials — try a hard reload.')
    console.log()
    return
  }

  head('What to do')
  // Distinct causes only: one bad refresh token fails all four identically.
  for (const line of remedy([...new Set(failures)][0])) console.log(`    ${line}`)
  console.log()
  process.exit(1)
}

main().catch((e) => {
  console.error()
  bad(`Unexpected failure: ${e?.stack ?? e}`)
  process.exit(1)
})

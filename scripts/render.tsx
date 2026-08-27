/**
 * Renders the whole app to a string, once per tab.
 *
 * There is no browser here, so this is the closest thing to opening it: it
 * executes every view's render path — including the empty states, which are
 * what a device with no key actually sees — and fails loudly on a crash that
 * a type check cannot catch.
 */
import { renderToString } from 'react-dom/server'
import App from '../src/App'
import KeyGate from '../src/components/KeyGate'
import type { TabId } from '../src/data/types'

const TABS: TabId[] = ['today', 'courses', 'due', 'markets']

let fails = 0

for (const tab of TABS) {
  try {
    const html = renderToString(<App userName="Alex" startTab={tab} />)
    const ok = html.includes('ld-phone') && html.length > 500
    if (!ok) fails++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${tab} renders (${html.length} chars)`)

    // The whole design principle of the empty states: never imply data exists.
    if (html.includes('undefined') || html.includes('NaN')) {
      fails++
      console.log(`FAIL ${tab} leaked an undefined or NaN into the markup`)
    }
  } catch (e) {
    fails++
    console.log(`FAIL ${tab} threw: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// The setup sheet is behind a tap, so no tab render reaches it — and it is the
// one screen that must work on a device that has nothing else working.
for (const rejected of [false, true]) {
  try {
    const html = renderToString(
      <KeyGate rejected={rejected} onInstall={() => {}} onClose={() => {}} />,
    )
    const ok = html.includes('ld-sheet')
    if (!ok) fails++
    console.log(`${ok ? 'ok  ' : 'FAIL'} key sheet renders (rejected=${rejected})`)
  } catch (e) {
    fails++
    console.log(`FAIL key sheet threw: ${e instanceof Error ? e.message : String(e)}`)
  }
}

console.log(fails === 0 ? '\nAll rendered.' : `\n${fails} FAILED`)
if (fails > 0) process.exit(1)

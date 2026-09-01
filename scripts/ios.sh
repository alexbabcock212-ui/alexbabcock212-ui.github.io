#!/usr/bin/env bash
#
# Build the web app and stage it into the native iOS project.
#
# The counterpart to deploy.sh: the same bundle, put in the app package rather
# than pushed to Pages. Run this after any change, then Cmd-R in Xcode.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# The Desktop scan has to happen here, on the Mac — neither the web view nor
# the Worker can see a filesystem. Skip with SKIP_SCAN=1 to reuse the last one.
if [[ "${SKIP_SCAN:-}" != "1" ]]; then
  bash scripts/scan.sh
  echo
fi

# A build with no service address cannot reach anything, and inside a native
# app that failure is even further from a console than it is on the phone.
if ! grep -qE '^VITE_API_BASE=\S' .env 2>/dev/null; then
  echo "VITE_API_BASE is empty in .env — deploy the Worker first (see README)." >&2
  exit 1
fi

npm run build
npx cap sync ios

echo
echo "Staged into ios/. Now:"
echo
echo "    npx cap open ios        # or: npm run ios:open"
echo
echo "In Xcode, once: select the App target → Signing & Capabilities →"
echo "Team = your Apple ID (Personal Team). Then pick your iPhone and hit Run."
echo
echo "The app starts with no device key — it has its own storage, separate from"
echo "Safari. Copy the key, then paste it into the sheet the app shows:"
echo
echo "    grep ^DASHBOARD_TOKEN .secrets.local | cut -d= -f2- | tr -d '\\n' | pbcopy"
echo
echo "The key is not printed here, so it stays out of your scrollback."

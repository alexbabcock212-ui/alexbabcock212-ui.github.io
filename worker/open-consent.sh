#!/usr/bin/env bash
#
# Open the Google consent screen.
#
# A script rather than a one-liner because the one-liner needs a quoted URL
# containing a command substitution, and losing the closing quote on the way
# through a copy-paste drops the shell into `dquote>` — which, on the way out,
# echoes the setup token. Nothing here needs quoting at the call site.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

token="$(grep '^SETUP_TOKEN=' .secrets.local | cut -d= -f2 | tr -d '[:space:]')"
if [[ -z "$token" ]]; then
  echo "No SETUP_TOKEN in .secrets.local." >&2
  exit 1
fi

echo "Opening Google's consent screen."
echo
echo "  1. Pick your account"
echo "  2. 'Google hasn't verified this app' -> Advanced -> Go to ... (unsafe)"
echo "  3. Approve all three read-only permissions"
echo "  4. Copy the token starting 1// from the page that follows"
echo
echo "Then run:  ./worker/set-secret.sh GOOGLE_REFRESH_TOKEN"

open "https://life-dashboard-api.alex-babcock212.workers.dev/auth/start?key=${token}"

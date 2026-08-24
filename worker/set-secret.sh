#!/usr/bin/env bash
#
# Store one Worker secret, read from a hidden prompt.
#
# Exists because the two obvious approaches both have a trap. Passing the value
# as an argument puts it in shell history (and names the secret after it, if you
# forget the name). Piping `pbpaste` fails whenever the command itself was
# copied to a clipboard, which is most of the time.
#
# So: the value is typed at a prompt, never echoed, and — the part that matters
# — checked against the shape it is supposed to have *before* anything is
# stored. A wrong paste fails loudly here instead of silently three steps later.
#
#   ./set-secret.sh GOOGLE_CLIENT_SECRET
#   ./set-secret.sh GOOGLE_REFRESH_TOKEN
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

name="${1:-}"
case "$name" in
  GOOGLE_CLIENT_SECRET) pattern='^GOCSPX-[A-Za-z0-9_-]{20,}$'; expect='GOCSPX- followed by ~28 characters' ;;
  GOOGLE_REFRESH_TOKEN) pattern='^1//[A-Za-z0-9_.-]{20,}$';    expect='1// followed by a long string' ;;
  DASHBOARD_TOKEN|SETUP_TOKEN) pattern='^[A-Za-z0-9_-]{16,}$'; expect='a long random string' ;;
  *)
    echo "usage: ./set-secret.sh <GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN|DASHBOARD_TOKEN|SETUP_TOKEN>" >&2
    exit 2 ;;
esac

printf 'Paste the value for %s (it will not be shown), then press Enter:\n> ' "$name"
IFS= read -rs value
printf '\n\n'

# Strip anything the clipboard picked up on the way — newlines especially.
value="$(printf '%s' "$value" | tr -d '[:space:]')"

if [[ -z "$value" ]]; then
  echo "Nothing was pasted. No change made." >&2
  exit 1
fi

if [[ ! "$value" =~ $pattern ]]; then
  echo "That does not look like $name." >&2
  echo "  expected : $expect" >&2
  echo "  got      : ${#value} characters starting '${value:0:7}'" >&2
  echo "No change made." >&2
  exit 1
fi

echo "Shape looks right (${#value} chars). Storing…"
printf '%s' "$value" | npx wrangler secret put "$name"

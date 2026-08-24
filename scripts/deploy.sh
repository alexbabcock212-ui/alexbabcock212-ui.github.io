#!/usr/bin/env bash
#
# Build and publish to the gh-pages branch that GitHub Pages serves.
#
# Pages is configured with source = gh-pages, path = /. Pushing here triggers
# a rebuild on its own; only *changing* the source branch needs a manual
# `gh api -X POST repos/<owner>/<repo>/pages/builds`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# The Desktop scan has to happen here, on the Mac — neither the browser nor the
# Worker can see a filesystem. Skip with SKIP_SCAN=1 to publish the last one.
if [[ "${SKIP_SCAN:-}" != "1" ]]; then
  bash scripts/scan.sh
  echo
fi

# A build with no service address cannot reach anything, and the failure only
# shows up on the phone. Catch it here instead.
if ! grep -qE '^VITE_API_BASE=\S' .env 2>/dev/null; then
  echo "VITE_API_BASE is empty in .env — deploy the Worker first (see README)." >&2
  exit 1
fi

npm run build

# Stop Pages running the build output through Jekyll, which would drop
# any file or directory beginning with an underscore.
touch dist/.nojekyll

remote="$(git remote get-url origin)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cp -R dist/. "$tmp/"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -qf "$remote" gh-pages

echo
echo "Deployed. Pages rebuilds in ~30s:"
echo "  https://$(basename "$remote" .git)/"

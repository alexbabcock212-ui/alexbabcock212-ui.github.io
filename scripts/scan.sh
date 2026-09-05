#!/usr/bin/env bash
# Bundles the scanners and runs them, so they can share the app's own parsers
# instead of keeping a second copy of each regex.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
npx vite build --ssr scripts/scan-courses.ts --outDir .check --logLevel warn >/dev/null
node .check/scan-courses.js

echo
npx vite build --ssr scripts/scan-groceries.ts --outDir .check --logLevel warn >/dev/null
node .check/scan-groceries.js

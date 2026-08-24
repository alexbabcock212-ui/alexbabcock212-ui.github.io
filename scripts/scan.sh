#!/usr/bin/env bash
# Bundles scripts/scan-courses.ts and runs it, so the scanner can share the
# app's own course-code parser instead of keeping a second copy of the regex.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
npx vite build --ssr scripts/scan-courses.ts --outDir .check --logLevel warn >/dev/null
node .check/scan-courses.js

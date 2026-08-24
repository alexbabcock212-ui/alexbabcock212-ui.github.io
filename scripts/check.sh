#!/usr/bin/env bash
# Bundles scripts/check.ts and runs it. Vite handles the TypeScript; the output
# lands in .check/, which is gitignored.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
npx vite build --ssr scripts/check.ts --outDir .check --logLevel warn >/dev/null
node .check/check.js

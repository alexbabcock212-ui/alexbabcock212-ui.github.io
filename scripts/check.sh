#!/usr/bin/env bash
# Bundles the checks and runs them. Vite handles the TypeScript and the JSX;
# the output lands in .check/, which is gitignored.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

npx vite build --ssr scripts/check.ts --outDir .check --logLevel warn >/dev/null
node .check/check.js

echo
npx vite build --ssr scripts/render.tsx --outDir .check --logLevel warn >/dev/null
node .check/render.js

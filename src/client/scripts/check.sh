#!/usr/bin/env bash
# TETHER client — CI-style check.
# Usage: src/client/scripts/check.sh   (run from the repo root)
set -euo pipefail
cd "$(dirname "$0")/../../.."   # repo root

echo "== 1/4 syntax: every client JS/MJS file parses =="
find src/client -name '*.js' -o -name '*.mjs' | while read -r f; do
  node --check "$f" || { echo "SYNTAX FAIL: $f"; exit 1; }
done
echo "   ok"

echo "== 2/4 contract: provided domain state machine tests =="
node --test src/domain.test.js 2>&1 | grep -E '^# (pass|fail)'

echo "== 3/4 lane: client state, bridge and status tests =="
node --test src/client/state/__tests__/*.test.mjs src/client/components/__tests__/*.test.mjs 2>&1 | grep -E '^# (pass|fail)'

echo "== 4/4 assets: every referenced static asset exists =="
missing=0
for f in \
  src/client/manifest.webmanifest src/client/sw.js \
  src/client/icons/icon-192.png src/client/icons/icon-512.png src/client/icons/icon-maskable-512.png \
  src/client/assets/fonts/fonts.css; do
  [ -f "$f" ] || { echo "MISSING: $f"; missing=1; }
done
grep -o 'url(\./[a-z0-9-]*\.woff2)' src/client/assets/fonts/fonts.css | sed 's|^url(\./||; s|)$||' | while read -r w; do
  [ -f "src/client/assets/fonts/$w" ] || { echo "MISSING FONT: $w"; exit 1; }
done
[ "$missing" = 0 ] && echo "   ok"

echo "ALL CHECKS PASSED"

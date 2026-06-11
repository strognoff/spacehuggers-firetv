#!/usr/bin/env bash
# scripts/sync-www.sh
#
# Mirror the hand-edited source files into the www/ bundle directory that
# Capacitor ships inside the APK. The two directories are normally identical;
# this script enforces that. The Android WebView loads from www/, so any
# source change not mirrored here will be invisible on the device.
#
# Add new file mappings to FILE_PAIR below as the project grows. Keep the list
# in sync with the source files that don't go through any build step (no
# bundler, no transpiler — these are loaded as-is by the engine).
#
# Usage:
#   bash scripts/sync-www.sh         # copy source -> www/
#   bash scripts/sync-www.sh --check # exit 1 if they differ (CI / pre-build)

set -euo pipefail

# Resolve to repo root regardless of where the script is invoked from.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO_ROOT"

# source-relative path : www-relative path
FILE_PAIRS=(
  "app.js:app.js"
  "appLevel.js:appLevel.js"
  "appCharacters.js:appCharacters.js"
  "appObjects.js:appObjects.js"
  "appEffects.js:appEffects.js"
  "engine/engine.js:engine/engine.js"
)

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
fi

DIVERGED=0

for pair in "${FILE_PAIRS[@]}"; do
  src="${pair%%:*}"
  dst="www/${pair##*:}"
  if [[ ! -f "$src" ]]; then
    echo "  WARN: source missing: $src (skipping)" >&2
    continue
  fi
  if [[ ! -f "$dst" ]]; then
    if [[ $CHECK_ONLY -eq 1 ]]; then
      echo "  MISSING: $dst" >&2
      DIVERGED=1
    else
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      echo "  + added   $dst"
    fi
    continue
  fi
  if diff -q "$src" "$dst" >/dev/null 2>&1; then
    : # in sync
  else
    if [[ $CHECK_ONLY -eq 1 ]]; then
      echo "  DIFF:    $src  vs  $dst" >&2
      DIVERGED=1
    else
      cp "$src" "$dst"
      echo "  updated  $dst"
    fi
  fi
done

if [[ $CHECK_ONLY -eq 1 ]]; then
  if [[ $DIVERGED -eq 1 ]]; then
    echo "" >&2
    echo "ERROR: source and www/ are out of sync. Run: bash scripts/sync-www.sh" >&2
    exit 1
  fi
  echo "OK: source and www/ are in sync"
  exit 0
fi

echo "Done. source -> www/ synced."

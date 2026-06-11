#!/usr/bin/env bash
set -euo pipefail

fail=0

check() {
  local name="$1"
  local cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "[OK] $name: $(command -v "$cmd")"
  else
    echo "[MISSING] $name ($cmd)"
    fail=1
  fi
}

check "Java" java
check "ADB" adb
check "Node" node
check "npm" npm
# Capacitor's android/ folder ships with gradlew, so a system gradle isn't required.

if [[ -n "${ANDROID_HOME:-}" ]]; then
  echo "[OK] ANDROID_HOME=$ANDROID_HOME"
else
  echo "[WARN] ANDROID_HOME not set (needed for adb/emulator + SDK tools)"
fi

if [[ -n "${JAVA_HOME:-}" ]]; then
  echo "[OK] JAVA_HOME=$JAVA_HOME"
else
  echo "[WARN] JAVA_HOME not set (using system java)"
fi

if [[ $fail -ne 0 ]]; then
  echo "Prerequisites missing. See docs/SETUP.md"
  exit 1
fi

echo "All required CLI prerequisites are present."

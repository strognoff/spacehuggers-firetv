#!/bin/bash
# Space Huggers Fire TV build & deploy
# Usage: ./scripts/build-and-deploy.sh [device-host:port]

set -e

# Always operate from the project root, no matter where the script is invoked from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "🚀 Starting build and deploy process..."

# Increment version
echo "📈 Incrementing version..."
npm run version:increment

# Build web assets
echo "🏗️  Building web assets..."
npm run build

# Sync with Capacitor
echo "🔄 Syncing with Capacitor..."
npx cap sync android

# Build Android debug APK
echo "🤖 Building Android debug APK..."
cd android
./gradlew clean assembleDebug
cd ..

APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
echo "✅ Build complete!"
echo "📦 APK location: $APK_PATH"

# Deploy to device if host is provided
if [ -n "$1" ]; then
  DEVICE_HOST="$1"
  echo "📲 Deploying to device at $DEVICE_HOST..."

  # Connect to device
  adb connect "$DEVICE_HOST"

  # Install APK
  echo "📦 Installing APK..."
  adb -s "$DEVICE_HOST" install -r "$APK_PATH"

  echo "✅ Deployment complete!"
else
  echo "ℹ️  No device host provided. Skipping deployment."
  echo "💡 To deploy, run: ./scripts/build-and-deploy.sh <device-ip>:5555"
fi
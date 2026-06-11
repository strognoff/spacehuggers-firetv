# Fire TV deploy & debug playbook

## Build and install

```bash
# One-time pairing
adb connect <fire-tv-ip>:5555

# Build + install
./scripts/build-and-deploy.sh <fire-tv-ip>:5555
```

The script does, in order:
1. Bumps `package.json` and `android/app/build.gradle` version (`version:increment`)
2. Runs `npm run build` (asset-presence check; no bundler)
3. `npx cap sync android` — copies `www/` into `android/app/src/main/assets/public/`
4. `./gradlew clean assembleDebug` — produces `android/app/build/outputs/apk/debug/app-debug.apk`
5. `adb install -r` onto the Fire TV

## What you should see

- **Green path:** Title screen with the controller-glyph HUD bottom-left.
- **Slow path:** Game runs on Canvas2D fallback (visible in `adb logcat` as `WebGL init failed, falling back to Canvas2D`).
- **Red path:** Black screen with white text in `#errbox` showing the JS error.
- **White path:** `adb logcat` will show `Renderer process (NNNN) crash detected (code -1)` — native WebView GPU process died.

## If you see a white screen

Capture a full logcat with chromium verbosity:

```bash
adb logcat -c
adb logcat chromium:V *:E > /tmp/firetv-crash.log
# ... reproduce the crash ...
# (Ctrl-C to stop logcat)
```

Look for:
- `Renderer process (NNNN) crash detected` → GPU process died; the WebGL fallback should kick in, but if it doesn't, the JS error overlay will show the JS error.
- `WebGL: CONTEXT_LOST_WEBGL` → the live context-lost listener fired; game should be running on Canvas2D now.
- `ClassNotFoundException: android.webkit.PacProcessor` → harmless Fire OS 7 noise, ignore.

## Force-Canvas2D mode

If the WebGL fallback isn't kicking in and the GPU crashes, you can force-disable WebGL by editing `www/engine/engineWebGL.js` line 15:

```js
let glEnable = 0;  // was: the runtime detection IIFE
```

This skips all WebGL paths. The game will run on Canvas2D directly. Performance is roughly 4-6x lower, but the game is fully playable on a 1080p Fire TV.

After editing, re-run `./scripts/build-and-deploy.sh <fire-tv-ip>:5555`.

## Force-WebGL mode

If Canvas2D is too slow and you want to *try* WebGL even on a crashing device (some Fire TV GPU driver bugs get fixed by `cap sync` updates to the WebView):

Edit `www/engine/engineWebGL.js` line 15 back to:

```js
let glEnable = 1;
```

## Inspecting on-device state

The WebView caches aggressively. To force a clean install:

```bash
adb shell pm clear com.spacehuggers.firetv
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

To open Chrome DevTools against the WebView:

```bash
# In a separate terminal:
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
# Then open http://localhost:9222 in Chrome on your dev machine
```

The PID can be found via `adb shell ps -A | grep spacehuggers`.

## Common build errors

- `error Failed to load resource: net::ERR_INTERNET_DISCONNECTED` in the WebView — Capacitor `androidScheme: "https"` is set, ignore.
- `BUILD FAILED: SDK location not found` — `export ANDROID_HOME=$HOME/Library/Android/sdk` (or your SDK path).
- `Could not find tools.jar` — install JDK 17 (`brew install --cask temurin@17`).
- App shows white but no `#errbox` — the WebView crashed before any JS ran. Check `adb logcat` for the renderer crash.

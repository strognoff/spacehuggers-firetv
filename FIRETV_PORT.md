# Fire TV Port (Capacitor)

This is the Fire TV port of Space Huggers, packaged via [Capacitor](https://capacitorjs.com/).

## What's been done

- `engine/engineInput.js` — Fire TV Media-Remote key codes (176-179) and Enter are
  remapped onto the in-game keys (Up, Z, Esc, C, Space).
- `engine/engineWebGL.js` — `glEnable` is now a runtime WebGL 1.0 detection.
  Older Fire TV WebViews without WebGL will fall back to Canvas2D.
- `engine/engine.js` — locked the canvas to 1920x1080 with the engine's built-in
  letterbox CSS, and added `visibilitychange` / `blur` / `focus` handlers so the
  game pauses when the WebView is backgrounded.
- `www/` — mirrored copy of the runtime assets (index.html, engine/, app*.js,
  tiles.png, favicon.ico) for Capacitor's `webDir`.
- `capacitor.config.json` — points Capacitor at `www/`.

## Building the Android / Fire TV APK

You need a one-time setup:

```bash
npm install
npx cap add android
```

Then for any change to `www/`, sync and build:

```bash
npx cap sync android
npx cap open android      # opens Android Studio
# ...or...
cd android && ./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Required Fire TV manifest tweaks

After `cap add android`, edit `android/app/src/main/AndroidManifest.xml` so
the app shows up in the Fire TV launcher (not the phone launcher):

```xml
<intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
    <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
</intent-filter>
```

And inside the root `<manifest>` element, add:

```xml
<uses-feature android:name="android.hardware.type.television" required="true" />
<uses-feature android:name="android.hardware.gamepad" required="false" />
```

Also lock to landscape in `MainActivity.java` (or via theme in
`android/app/src/main/res/values/styles.xml`):

```xml
<item name="android:screenOrientation">landscape</item>
```

## Fire TV banner

The Amazon Appstore requires a 320x180 PNG banner in
`android/app/src/main/res/drawable-xhdpi/banner.png` and a `<banner>` element
in the launcher activity in `AndroidManifest.xml`:

```xml
<activity
    android:name=".MainActivity"
    android:banner="@drawable/banner">
    ...
</activity>
```

## Required permissions

No special permissions are needed — the game makes no network calls, reads no
storage, and uses no sensors. No `<uses-permission>` entries are required.

## Testing on a real Fire TV

1. Enable ADB on the Fire TV: Settings → My Fire TV → Developer Options → ADB
   Debugging → On.
2. Get the device IP (Settings → My Fire TV → About → Network).
3. From your dev machine: `adb connect <fire-tv-ip>:5555`
4. Install: `adb install app/build/outputs/apk/debug/app-debug.apk`
5. The app appears under "Your Apps" on the Fire TV home screen, or under
   "Games" once the Leanback category is set.

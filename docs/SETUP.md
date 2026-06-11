# Setup — Space Huggers Fire TV port

These are the tools required to build the APK and deploy it to a Fire TV.

## One-time setup

| Tool | Why | Install |
|---|---|---|
| **Node.js 18+** | runs the build scripts | `brew install node` |
| **Java 17** (JDK) | required by Android Gradle Plugin 8 | `brew install --cask temurin@17` |
| **Android SDK** + `platform-tools` | `adb` and the Android build tools | [Android Studio](https://developer.android.com/studio) → SDK Manager → install API 34 |
| **Capacitor CLI** | scaffolds and syncs the Android project | `npm install` (already declared in `devDependencies`) |

Set these environment variables in your shell rc file (`~/.zshrc` / `~/.bashrc`):

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

## First-time project init

After cloning the repo, from the project root:

```bash
npm install
npx cap add android
```

This creates the `android/` folder and pulls down Capacitor's native scaffolding.

## Apply the Fire TV manifest patch

```bash
patch -p1 < firetv-manifest.patch
```

Adds the `LEANBACK_LAUNCHER` category, `uses-feature television`, and the banner reference.

## Drop a banner into the Android project

```bash
mkdir -p android/app/src/main/res/drawable-xhdpi
# Save a 320x180 PNG as android/app/src/main/res/drawable-xhdpi/banner.png
```

The Amazon Appstore rejects APKs without a banner.

## Build and deploy

```bash
# Sanity-check tooling
npm run prereqs

# Build only
./scripts/build-and-deploy.sh

# Build + install to a Fire TV at 192.168.1.42
./scripts/build-and-deploy.sh 192.168.1.42:5555
```

The first build will download Gradle, the Android Gradle Plugin, and the AndroidX libraries — this takes a few minutes. Subsequent builds are incremental.

## Pairing a Fire TV over ADB

1. On the Fire TV: **Settings → My Fire TV → Developer Options** → enable **ADB Debugging** and **Apps from Unknown Sources**.
2. Note the device's IP under **Settings → My Fire TV → About → Network**.
3. From your dev machine: `adb connect 192.168.1.42:5555`
4. Verify: `adb devices` should list the Fire TV as `device`.
5. Run `./scripts/build-and-deploy.sh 192.168.1.42:5555`.

The app appears under **Your Apps & Channels → Your Apps** on the Fire TV home screen once installed.

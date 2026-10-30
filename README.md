<p align="center"><img src="src-tauri/icons/128x128@2x.png" width="128" alt="TVoid"></p>
<h1 align="center">TVoid</h1>
<p align="center">Declutter your Android TV / Google TV from the desktop. No root, no cable, everything reversible.</p>

TVoid talks to your TV over Wi-Fi ADB (port 5555) and **disables** (never uninstalls)
telemetry, ads and preloaded apps. Every change is recorded first, so one click
restores the TV as it was. Built with Rust and [Tauri](https://tauri.app); the ADB
client is native, so you don't need `adb` installed.

## Features
- Interface in English (default), Italiano, Español, Français and Deutsch; pick it top right.
- Connect by IP; the TV asks to authorize the key once.
- Scan installed packages, search and filter, import a `debloat.txt` list.
- A review step runs the safety checks before anything is applied:
  protected system packages, last remaining launcher, HDMI input drivers, saved Wi-Fi.
- Undo record in `~/.tvoid/` written before the first change; one-click restore of
  packages, Home app and animation settings.
- Optional alternative Home launcher, with automatic rollback if the Home doesn't switch.

## Enable ADB on the TV
Settings → Device Preferences → About → press OK 7 times on **Build** →
Developer options → turn on **USB debugging** (and network debugging if present).

## Run
Requires Rust and Node.js.

```sh
npm install
npx tauri dev          # run
npx tauri build        # installable bundle
```

## Launcher (optional)
The launcher is a separate Android app and is not bundled. Build it once with

```sh
scripts/build-launcher.sh
```

which clones the upstream source at a pinned commit and builds it with Gradle
(needs JDK 17 and the Android SDK). **This runs third-party build scripts on your
machine**; read them first if you want to be sure. The APK lands in
`~/.tvoid/launcher.apk`. You can also pick any APK from the Launcher dialog.

## Safety
Use at your own risk. Disabling the wrong package can break a TV; the app protects
the known critical ones, but firmware differs. `Restore` re-enables what TVoid disabled.
Only connect to TVs you own.

## Credits and license
MIT, see [LICENSE](LICENSE). Inspired by and ported from
[CleanYourTV](https://github.com/Gathin23/cleanyourtv), see [NOTICE.md](NOTICE.md).

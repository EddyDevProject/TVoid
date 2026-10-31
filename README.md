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
- Scan installed packages, search and filter. Ticking a package means it will be **disabled**; unticked ones are never touched.
- 360 ready-made debloat lists by TV model (auto-detected from the connected TV), or import your own `debloat.txt`.
- A review step runs the safety checks before anything is applied:
  protected system packages, last remaining launcher, HDMI input drivers, saved Wi-Fi.
- Undo record in `~/.tvoid/` written before the first change; one-click restore of
  packages, Home app and animation settings.
- Optional alternative Home launcher, with automatic rollback if the Home doesn't switch.

## Enable ADB on the TV
Settings → Device Preferences → About → press OK 7 times on **Build** →
Developer options → turn on **USB debugging** (and network debugging if present).

## Install
Download the installer for your system from [Releases](../../releases).
The installers are not code-signed by Apple or Microsoft, so the system warns on first launch:
- **macOS:** right-click the app → Open. If it says the app is "damaged", that is Gatekeeper
  blocking a download without a signature; run `xattr -cr /Applications/TVoid.app` once.
- **Windows:** More info → Run anyway.

## Run from source
Requires Rust and Node.js.

```sh
npm install
npx tauri dev          # run
npx tauri build        # installable bundle
```

## Launcher (optional)
The launcher is a separate Android app by the upstream project. In the **Launcher**
dialog, **Download launcher** fetches the APK from the latest published TVoid release
and checks it against the SHA-256 published next to it. (The hash comes from the same
release, so it guards against corruption, not against a compromised release.)

To build it yourself instead:

```sh
scripts/build-launcher.sh
```

which clones the upstream source at a pinned commit and builds it with Gradle
(needs JDK 17 and the Android SDK). **This runs third-party build scripts on your
machine**; read them first if you want to be sure. The APK lands in
`~/.tvoid/launcher.apk`. You can also pick any APK from the Launcher dialog.

## Updates
On startup TVoid checks the latest published release and, if there is a newer version,
offers to download, install and restart. Update packages are signed with a minisign key;
the public key is in `src-tauri/tauri.conf.json`, so only releases signed with the
matching private key are accepted. Nothing is sent besides the download request.

Maintainers: the release workflow needs two repository secrets,
`TAURI_SIGNING_PRIVATE_KEY` (contents of the private key file) and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty if the key has no password).
Generate a key with `npx tauri signer generate -w ~/.tauri/tvoid-updater.key` and put
the new public key in `tauri.conf.json`. Keep the private key out of the repo.

## Safety
Use at your own risk. Disabling the wrong package can break a TV; the app protects
the known critical ones, but firmware differs. `Restore` re-enables what TVoid disabled.
Only connect to TVs you own.

## Credits and license
MIT, see [LICENSE](LICENSE). Inspired by and ported from
[CleanYourTV](https://github.com/Gathin23/cleanyourtv), see [NOTICE.md](NOTICE.md).

#!/usr/bin/env bash
# Builds the upstream launcher APK (MIT, github.com/Gathin23/cleanyourtv) at a pinned commit
# and drops it in ~/.tvoid/launcher.apk, where TVoid picks it up.
#
# This runs third-party build scripts (Gradle wrapper, AndroidX from Maven) on your machine.
# Read launcher/ in the upstream repo first if you want to be sure.
set -euo pipefail

REPO=https://github.com/Gathin23/cleanyourtv.git
TAG=v3.2.0
COMMIT=42fe7b09d61fb9175cb03b8c659cd63c9c1dd9a4

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
[ -d "$SDK" ] || SDK="$HOME/Android/Sdk"
[ -d "$SDK" ] || { echo "Android SDK non trovato: imposta ANDROID_HOME" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet --depth 1 --branch "$TAG" "$REPO" "$WORK/src"
[ "$(git -C "$WORK/src" rev-parse HEAD)" = "$COMMIT" ] || { echo "il tag $TAG non punta più a $COMMIT: mi fermo" >&2; exit 1; }

cd "$WORK/src/launcher"
echo "sdk.dir=$SDK" > local.properties
./gradlew assembleRelease -q --console=plain

mkdir -p "$HOME/.tvoid"
cp app/build/outputs/apk/release/app-release.apk "$HOME/.tvoid/launcher.apk"
echo "OK: $HOME/.tvoid/launcher.apk"

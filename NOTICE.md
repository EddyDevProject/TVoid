# Credits

TVoid is a Rust/Tauri desktop app inspired by
[CleanYourTV](https://github.com/Gathin23/cleanyourtv) by Gathin (MIT License,
Copyright (c) 2026 Gathin). The debloat flow, the safety rules (protected
packages, Home-launcher guard, HDMI input drivers, saved Wi-Fi) and the
launcher install sequence are ported from its scripts. TVoid is an independent
project and is not affiliated with it.

The optional TV launcher (`com.gathin.tvhome`) is that project's work. It is not
included in this repository: `scripts/build-launcher.sh` builds it from the
upstream source at a pinned commit. Its Outfit font is under the SIL OFL 1.1
and its icons under their own license; see the upstream `launcher/` folder.

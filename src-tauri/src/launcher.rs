//! Install the TV home launcher and make it the Home app, with automatic rollback.
//! Flow ported from launcher/build-and-install.sh of the upstream project.

use super::*;
use serde::Serialize;

/// Upstream default applicationId.
const LAUNCHER_PKG: &str = "com.gathin.tvhome";
const LAUNCHER_ACTIVITY: &str = "com.gathin.tvhome/.MainActivity";
const MIN_SDK: u32 = 26;

#[derive(Serialize)]
pub struct LauncherStatus {
    has_apk: bool,
    installed: bool,
    is_home: bool,
    home: String,
    stock: Option<String>,
    sdk_ok: bool,
}

fn apk_path() -> Result<std::path::PathBuf, String> {
    Ok(recovery::data_dir()?.join("launcher.apk"))
}

fn pkg_of(component: &str) -> &str {
    component.split('/').next().unwrap_or("")
}

#[tauri::command(async)]
pub fn launcher_status(state: tauri::State<State>) -> Result<LauncherStatus, String> {
    let has_apk = apk_path()?.exists();
    with_tv(&state, |tv| {
        let home = current_home(tv).unwrap_or_default();
        let sdk: u32 = tv.prop("ro.build.version.sdk").parse().unwrap_or(0);
        let stock = safety::KNOWN_LAUNCHERS
            .iter()
            .find(|k| **k == pkg_of(&home))
            .map(|k| k.to_string());
        Ok(LauncherStatus {
            has_apk,
            installed: list_pkgs(tv, "").contains(LAUNCHER_PKG),
            is_home: pkg_of(&home) == LAUNCHER_PKG,
            home,
            stock,
            sdk_ok: sdk >= MIN_SDK,
        })
    })
}

/// `apk`: bytes of a launcher APK chosen by the user (kept for next time),
/// or None to reuse the one saved in the data folder.
#[tauri::command(async)]
pub fn launcher_install(state: tauri::State<State>, apk: Option<Vec<u8>>) -> Result<Vec<String>, String> {
    let path = apk_path()?;
    if let Some(bytes) = apk {
        if bytes.len() < 1024 || &bytes[..2] != b"PK" {
            return Err("e:not_apk".into());
        }
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        return Err("e:no_apk".into());
    }

    with_tv(&state, |tv| {
        let mut log = Vec::new();
        let sdk: u32 = tv.prop("ro.build.version.sdk").parse().unwrap_or(0);
        if sdk < MIN_SDK {
            return Err(format!("e:sdk_old:{sdk}:{MIN_SDK}"));
        }

        let prev_home = current_home(tv).ok_or("e:no_home")?;
        let stock = safety::KNOWN_LAUNCHERS
            .iter()
            .find(|k| **k == pkg_of(&prev_home))
            .map(|k| k.to_string());

        // Undo record first: stock launcher state + previous Home.
        let mut to_record = vec![LAUNCHER_PKG.to_string()];
        to_record.extend(stock.clone());
        record_before(tv, &to_record)?;
        log.push("l:record_saved".into());

        tv.install(&path)?;
        log.push("l:apk_installed".into());

        let started = tv.sh(&format!(
            "am start -W -a android.intent.action.MAIN -c android.intent.category.HOME -n {LAUNCHER_ACTIVITY}"
        ))?;
        if !started.contains("Status: ok") {
            return Err(format!("e:start_failed:{started}"));
        }
        log.push("l:started".into());

        tv.sh(&format!("pm grant {LAUNCHER_PKG} android.permission.ACCESS_FINE_LOCATION"))?;
        tv.sh(&format!("cmd package compile -m speed -f {LAUNCHER_PKG}"))?;
        if let Some(s) = &stock {
            tv.sh(&format!("pm disable-user --user 0 {s}"))?;
            log.push(format!("l:disabled:{s}"));
        }
        tv.sh(&format!("cmd package set-home-activity --user 0 {LAUNCHER_ACTIVITY}"))?;

        let now = current_home(tv).unwrap_or_default();
        if pkg_of(&now) != LAUNCHER_PKG {
            // Rollback: stock launcher back, Home back.
            if let Some(s) = &stock {
                let _ = tv.sh(&format!("pm enable --user 0 {s}"));
            }
            if prev_home.split('/').all(|p| p.starts_with('.') || safety::is_valid_name(p)) {
                let _ = tv.sh(&format!("cmd package set-home-activity --user 0 {prev_home}"));
            }
            return Err("e:home_not_switched".into());
        }
        log.push("l:home_set".into());
        Ok(log)
    })
}

const RELEASE_API: &str = "https://api.github.com/repos/EddyDevProject/TVoid/releases/latest";
const DOWNLOAD_PREFIX: &str = "https://github.com/EddyDevProject/TVoid/releases/download/";
const MAX_APK_BYTES: u64 = 20 * 1024 * 1024;

fn http_get(url: &str, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let resp = ureq::get(url)
        .set("User-Agent", "tvoid")
        .timeout(std::time::Duration::from_secs(60))
        .call()
        .map_err(|e| format!("e:download_failed:{e}"))?;
    let mut buf = Vec::new();
    resp.into_reader()
        .take(limit + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("e:download_failed:{e}"))?;
    if buf.len() as u64 > limit {
        return Err("e:download_failed:too large".into());
    }
    Ok(buf)
}

/// Download the launcher APK from the latest published TVoid release and check it
/// against the SHA-256 published next to it. Returns the release tag.
#[tauri::command(async)]
pub fn launcher_download() -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let release: serde_json::Value = serde_json::from_slice(&http_get(RELEASE_API, 1024 * 1024)?)
        .map_err(|e| format!("e:download_failed:{e}"))?;
    let tag = release["tag_name"].as_str().unwrap_or("?").to_string();

    let asset_url = |name: &str| -> Result<String, String> {
        release["assets"]
            .as_array()
            .and_then(|a| a.iter().find(|x| x["name"] == name))
            .and_then(|x| x["browser_download_url"].as_str())
            .filter(|u| u.starts_with(DOWNLOAD_PREFIX))
            .map(str::to_string)
            .ok_or_else(|| "e:no_release_apk".to_string())
    };
    let apk_url = asset_url("tvoid-launcher.apk")?;
    let sum_url = asset_url("tvoid-launcher.apk.sha256")?;

    let apk = http_get(&apk_url, MAX_APK_BYTES)?;
    let sum_text = String::from_utf8_lossy(&http_get(&sum_url, 4096)?).to_string();
    let expected = sum_text.split_whitespace().next().unwrap_or("").to_lowercase();

    let actual: String = Sha256::digest(&apk).iter().map(|b| format!("{b:02x}")).collect();
    if expected.len() != 64 || actual != expected {
        return Err("e:hash_mismatch".into());
    }
    if apk.len() < 1024 || &apk[..2] != b"PK" {
        return Err("e:not_apk".into());
    }

    let path = apk_path()?;
    let tmp = path.with_extension("apk.part");
    std::fs::write(&tmp, &apk).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(tag)
}

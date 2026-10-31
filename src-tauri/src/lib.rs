mod adb;
mod launcher;
mod recovery;
mod safety;

use adb::Tv;
use recovery::Record;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

const HOME_ARGS: &str = "-a android.intent.action.MAIN -c android.intent.category.HOME";

#[derive(Default)]
struct State(Mutex<Option<Tv>>);

fn with_tv<T>(
    state: &tauri::State<State>,
    f: impl FnOnce(&mut Tv) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|_| "e:poisoned".to_string())?;
    let tv = guard.as_mut().ok_or("e:no_tv")?;
    f(tv)
}

#[derive(Serialize)]
struct Probe {
    host: String,
    model: String,
    device: String,
    manufacturer: String,
    android: String,
    sdk: String,
    build: String,
    secure: String,
    home: String,
}

#[derive(Serialize)]
struct Pkg {
    name: String,
    enabled: bool,
    system: bool,
}

#[derive(Serialize)]
struct PlanItem {
    name: String,
    /// "ok" | "skip" | "absent" | "disabled"
    status: String,
    reason: String,
}

#[derive(Serialize)]
struct ActionResult {
    name: String,
    ok: bool,
    detail: String,
}

fn pkg_set(out: &str) -> BTreeSet<String> {
    out.lines()
        .filter_map(|l| l.trim().strip_prefix("package:"))
        .map(|s| s.trim().to_string())
        .collect()
}

fn list_pkgs(tv: &mut Tv, flags: &str) -> BTreeSet<String> {
    match tv.sh(&format!("pm list packages {flags} --user 0")) {
        Ok(o) if o.contains("package:") => pkg_set(&o),
        _ => tv.sh(&format!("pm list packages {flags}")).map(|o| pkg_set(&o)).unwrap_or_default(),
    }
}

fn current_home(tv: &mut Tv) -> Option<String> {
    let out = tv.sh(&format!("cmd package resolve-activity --brief {HOME_ARGS}")).ok()?;
    let last = out.lines().last()?.trim().to_string();
    last.contains('/').then_some(last)
}

fn home_packages(tv: &mut Tv) -> BTreeSet<String> {
    tv.sh(&format!("cmd package query-activities --brief {HOME_ARGS}"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.trim().split('/').next().map(str::to_string))
        .filter(|p| safety::is_valid_name(p))
        .collect()
}


/// Save the undo record before touching `packages`. The first record for a TV wins;
/// later runs only add names that are not in it yet.
fn record_before(tv: &mut Tv, packages: &[String]) -> Result<(), String> {
    let installed = list_pkgs(tv, "");
    let disabled = list_pkgs(tv, "-d");

    let mut rec = recovery::load(&tv.host)?.unwrap_or_else(|| Record {
        version: 1,
        host: tv.host.clone(),
        home: current_home(tv),
        settings: ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]
            .iter()
            .map(|k| {
                let v = tv.sh(&format!("settings get global {k}")).ok().filter(|v| v != "null" && !v.is_empty());
                (k.to_string(), v)
            })
            .collect::<BTreeMap<_, _>>(),
        packages: BTreeMap::new(),
    });
    for p in packages {
        let before = if !installed.contains(p) {
            "absent"
        } else if disabled.contains(p) {
            "disabled"
        } else {
            "enabled"
        };
        rec.packages.entry(p.clone()).or_insert_with(|| before.to_string());
    }
    recovery::save(&tv.host, &rec).map_err(|e| format!("e:save_failed:{e}"))
}

#[tauri::command(async)]
fn connect(state: tauri::State<State>, host: String) -> Result<Probe, String> {
    let host = host.trim().to_string();
    let mut tv = Tv::connect(&host)?;
    let probe = Probe {
        host: host.clone(),
        model: tv.prop("ro.product.model"),
        device: tv.prop("ro.product.device"),
        manufacturer: tv.prop("ro.product.manufacturer"),
        android: tv.prop("ro.build.version.release"),
        sdk: tv.prop("ro.build.version.sdk"),
        build: tv.prop("ro.build.display.id"),
        secure: tv.prop("ro.adb.secure"),
        home: current_home(&mut tv).unwrap_or_default(),
    };
    *state.0.lock().map_err(|_| "e:poisoned".to_string())? = Some(tv);
    Ok(probe)
}

#[tauri::command(async)]
fn disconnect(state: tauri::State<State>) {
    if let Ok(mut g) = state.0.lock() {
        *g = None;
    }
}

#[tauri::command(async)]
fn scan(state: tauri::State<State>) -> Result<Vec<Pkg>, String> {
    with_tv(&state, |tv| {
        let all = list_pkgs(tv, "");
        let disabled = list_pkgs(tv, "-d");
        let system = list_pkgs(tv, "-s");
        Ok(all
            .into_iter()
            .filter(|p| !safety::is_core(p))
            .map(|name| Pkg {
                enabled: !disabled.contains(&name),
                system: system.contains(&name),
                name,
            })
            .collect())
    })
}

#[tauri::command]
fn parse_list(text: String) -> Result<Vec<String>, String> {
    safety::parse_list(&text)
}

/// Dry run of every safety check in tools/disable.sh.
#[tauri::command(async)]
fn plan(state: tauri::State<State>, packages: Vec<String>) -> Result<Vec<PlanItem>, String> {
    with_tv(&state, |tv| {
        let installed = list_pkgs(tv, "");
        let disabled = list_pkgs(tv, "-d");
        let homes = home_packages(tv);
        let mut remaining_homes = homes.clone();
        let mut items = Vec::new();

        let mk = |name: &str, status: &str, reason: &str| PlanItem {
            name: name.to_string(),
            status: status.to_string(),
            reason: reason.to_string(),
        };

        for name in packages {
            if !safety::is_valid_name(&name) {
                items.push(mk(&name, "skip", "invalid_name"));
            } else if safety::is_core(&name) {
                items.push(mk(&name, "skip", "protected"));
            } else if !installed.contains(&name) {
                items.push(mk(&name, "absent", "not_installed"));
            } else if disabled.contains(&name) {
                items.push(mk(&name, "disabled", "already_disabled"));
            } else if name == safety::SETUP_WIZARD
                && tv
                    .sh("dumpsys wifi | grep -o 'cname=[^ ]*'")
                    .unwrap_or_default()
                    .contains(&name)
            {
                items.push(mk(&name, "skip", "owns_wifi"));
            } else if homes.contains(&name) && remaining_homes.len() <= 1 {
                items.push(mk(&name, "skip", "last_launcher"));
            } else if tv
                .sh(&format!("dumpsys package {name}"))
                .unwrap_or_default()
                .contains("android.permission.TV_INPUT_HARDWARE")
            {
                items.push(mk(&name, "skip", "tv_input"));
            } else {
                remaining_homes.remove(&name);
                items.push(mk(&name, "ok", ""));
            }
        }
        Ok(items)
    })
}

/// Save the undo record first, then disable. A failed save aborts everything.
#[tauri::command(async)]
fn apply(state: tauri::State<State>, packages: Vec<String>) -> Result<Vec<ActionResult>, String> {
    with_tv(&state, |tv| {
        record_before(tv, &packages)?;

        let mut results = Vec::new();
        for p in packages {
            if !safety::is_valid_name(&p) || safety::is_core(&p) {
                results.push(ActionResult { name: p, ok: false, detail: "refused".into() });
                continue;
            }
            let out = tv.sh(&format!("pm disable-user --user 0 {p}"))?;
            results.push(ActionResult { ok: out.contains("new state: disabled"), detail: out, name: p });
        }
        Ok(results)
    })
}

#[derive(Serialize)]
struct RecoveryInfo {
    packages: usize,
    to_enable: Vec<String>,
}

#[tauri::command(async)]
fn recovery_info(state: tauri::State<State>) -> Result<Option<RecoveryInfo>, String> {
    with_tv(&state, |tv| {
        Ok(recovery::load(&tv.host)?.map(|r| RecoveryInfo {
            packages: r.packages.len(),
            to_enable: r.packages.iter().filter(|(_, s)| *s == "enabled").map(|(p, _)| p.clone()).collect(),
        }))
    })
}

#[tauri::command(async)]
fn restore(state: tauri::State<State>) -> Result<Vec<ActionResult>, String> {
    with_tv(&state, |tv| {
        let rec = recovery::load(&tv.host)?.ok_or("e:no_record")?;
        let mut results = Vec::new();
        for (p, was) in &rec.packages {
            if was != "enabled" || !safety::is_valid_name(p) {
                continue;
            }
            let out = tv.sh(&format!("pm enable {p}"))?;
            results.push(ActionResult { ok: out.contains("new state: enabled"), detail: out, name: p.clone() });
        }
        if let Some(home) = rec.home.as_deref().filter(|h| {
            h.split('/').all(|s| safety::is_valid_name(s) || s.starts_with('.'))
        }) {
            let out = tv.sh(&format!("cmd package set-home-activity --user 0 {home}"))?;
            results.push(ActionResult { name: "home".into(), ok: true, detail: out });
        }
        for (k, v) in &rec.settings {
            if !k.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
                continue;
            }
            let cmd = match v {
                Some(v) if v.chars().all(|c| c.is_ascii_digit() || c == '.') => format!("settings put global {k} {v}"),
                _ => format!("settings delete global {k}"),
            };
            tv.sh(&cmd)?;
        }
        Ok(results)
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(State::default())
        .invoke_handler(tauri::generate_handler![
            connect, disconnect, scan, launcher::launcher_status, launcher::launcher_install, launcher::launcher_download, parse_list, plan, apply, recovery_info, restore
        ])
        .run(tauri::generate_context!())
        .expect("errore nell'avvio dell'app");
}

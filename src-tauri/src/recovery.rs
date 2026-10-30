//! On-disk undo record, same idea as tools/recovery.py: written before the first
//! change; the first record for a TV wins, re-runs only add new names.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Record {
    pub version: u32,
    pub host: String,
    pub home: Option<String>,
    pub settings: BTreeMap<String, Option<String>>,
    /// package -> "absent" | "disabled" | "enabled" (state before we touched it)
    pub packages: BTreeMap<String, String>,
}

pub fn data_dir() -> Result<PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or("e:no_home_dir")?
        .join(".tvoid");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn path_for(host: &str) -> Result<PathBuf, String> {
    let tag: String = host
        .split(':')
        .next()
        .unwrap_or(host)
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '_' })
        .collect();
    Ok(data_dir()?.join(format!("recovery-{tag}.json")))
}

pub fn load(host: &str) -> Result<Option<Record>, String> {
    let p = path_for(host)?;
    match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).map(Some).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save(host: &str, rec: &Record) -> Result<(), String> {
    let p = path_for(host)?;
    let tmp = p.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(rec).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

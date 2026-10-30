//! Package validation and the "never touch this" rules, ported from tools/disable.sh.

use once_cell::sync::Lazy;
use regex::Regex;

static PKG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$").unwrap());

static CORE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^(android|com\.android\.(systemui|shell|phone|settings|tv\.settings|permissioncontroller|packageinstaller|ext\.services|ext\.shared|modulemetadata)|com\.google\.android\.overlay\.modules\..*|com\.cltv\.mal|com\.mediatek\.(tis|tv\.service|tv\.agent))$",
    )
    .unwrap()
});

const PROVIDER_EXCEPTIONS: [&str; 4] = [
    "com.android.providers.calendar",
    "com.android.providers.contacts",
    "com.android.providers.userdictionary",
    "com.android.providers.blockednumber",
];

pub const KNOWN_LAUNCHERS: [&str; 4] = [
    "com.google.android.tvlauncher",
    "com.google.android.apps.tv.launcherx",
    "com.google.android.leanbacklauncher",
    "com.mitv.tvhome",
];

pub const SETUP_WIZARD: &str = "com.google.android.tungsten.setupwraith";

pub fn is_valid_name(pkg: &str) -> bool {
    PKG_RE.is_match(pkg)
}

pub fn is_core(pkg: &str) -> bool {
    if CORE_RE.is_match(pkg) {
        return true;
    }
    pkg.starts_with("com.android.providers.") && !PROVIDER_EXCEPTIONS.contains(&pkg)
}

/// Parse a debloat list: `#` comments, one package per line.
/// Returns the package names, or the first invalid line.
pub fn parse_list(text: &str) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for raw in text.trim_start_matches('\u{feff}').lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        if !is_valid_name(line) {
            return Err(format!("riga non valida: {line}"));
        }
        if !out.iter().any(|p| p == line) {
            out.push(line.to_string());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_packages_are_refused() {
        assert!(is_core("android"));
        assert!(is_core("com.android.systemui"));
        assert!(is_core("com.android.providers.media"));
        assert!(!is_core("com.android.providers.calendar"));
        assert!(!is_core("com.xiaomi.statistic"));
    }

    #[test]
    fn list_parsing() {
        let l = parse_list("# c\ncom.a.b  # note\r\n\ncom.a.b\ncom.c.d\n").unwrap();
        assert_eq!(l, vec!["com.a.b", "com.c.d"]);
        assert!(parse_list("rm -rf /").is_err());
        assert!(parse_list("com.a.b;reboot").is_err());
    }
}

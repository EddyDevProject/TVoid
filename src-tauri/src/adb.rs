use adb_client::tcp::ADBTcpDevice;
use adb_client::ADBDeviceExt;
use rsa::pkcs8::{EncodePrivateKey, LineEnding};
use rsa::RsaPrivateKey;
use std::net::{SocketAddr, ToSocketAddrs};
use std::path::PathBuf;

use crate::recovery::data_dir;

pub struct Tv {
    pub host: String,
    dev: ADBTcpDevice,
}

/// Persistent key, so the TV only asks "Allow USB debugging?" once.
fn ensure_key() -> Result<PathBuf, String> {
    let path = data_dir()?.join("adbkey");
    if !path.exists() {
        let key = RsaPrivateKey::new(&mut rsa::rand_core::OsRng, 2048).map_err(|e| e.to_string())?;
        let pem = key.to_pkcs8_pem(LineEnding::LF).map_err(|e| e.to_string())?;
        std::fs::write(&path, pem.as_bytes()).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
    Ok(path)
}

fn resolve(host: &str) -> Result<SocketAddr, String> {
    let target = if host.contains(':') { host.to_string() } else { format!("{host}:5555") };
    target
        .to_socket_addrs()
        .map_err(|e| format!("e:bad_address:{e}"))?
        .next()
        .ok_or_else(|| "e:bad_address:".to_string())
}

impl Tv {
    pub fn connect(host: &str) -> Result<Self, String> {
        let addr = resolve(host)?;
        let key = ensure_key()?;
        let dev = ADBTcpDevice::new_with_custom_private_key(addr, key)
            .map_err(|e| format!("e:connect_failed:{e}"))?;
        Ok(Self { host: host.to_string(), dev })
    }

    pub fn sh(&mut self, cmd: &str) -> Result<String, String> {
        let mut out: Vec<u8> = Vec::new();
        self.dev
            .shell_command(&cmd, Some(&mut out), None)
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&out).replace('\r', "").trim().to_string())
    }

    pub fn install(&mut self, apk: &std::path::Path) -> Result<(), String> {
        self.dev.install(&apk, None).map_err(|e| format!("e:install_failed:{e}"))
    }

    pub fn prop(&mut self, name: &str) -> String {
        self.sh(&format!("getprop {name}")).unwrap_or_default()
    }
}

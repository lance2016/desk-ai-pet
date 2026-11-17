//! curl takes a proxy only from the environment, and an app started from
//! Finder has none. The proxy set in System Settings → Network is read here
//! and handed to curl, so networks that require it still work.

use std::process::Command;

const PROXY_ENV: [&str; 4] = ["https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"];

/// Extra curl arguments for the system proxy. Empty when the environment
/// already names one (curl reads it itself) or none is turned on. Read on each
/// request, so turning a proxy on or off takes effect without a restart.
pub fn curl_args() -> Vec<String> {
    let from_env = PROXY_ENV
        .iter()
        .any(|key| std::env::var_os(key).is_some_and(|value| !value.is_empty()));
    if from_env {
        return Vec::new();
    }
    let Ok(output) = Command::new("/usr/sbin/scutil").arg("--proxy").output() else {
        return Vec::new();
    };
    match system_proxy(&String::from_utf8_lossy(&output.stdout)) {
        Some(proxy) => vec!["--proxy".into(), proxy],
        None => Vec::new(),
    }
}

/// The proxy URL from `scutil --proxy` output: the HTTPS proxy, else SOCKS.
/// Automatic configuration (PAC) is not followed.
fn system_proxy(text: &str) -> Option<String> {
    let value = |key: &str| {
        text.lines().find_map(|line| {
            let (name, value) = line.split_once(" : ")?;
            (name.trim() == key).then(|| value.trim().to_string())
        })
    };
    let enabled = |key: &str| value(key).as_deref() == Some("1");
    if enabled("HTTPSEnable") {
        Some(format!("http://{}:{}", value("HTTPSProxy")?, value("HTTPSPort")?))
    } else if enabled("SOCKSEnable") {
        Some(format!("socks5h://{}:{}", value("SOCKSProxy")?, value("SOCKSPort")?))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::system_proxy;

    const CLASH: &str = "<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 7891
  SOCKSProxy : 127.0.0.1
}";

    #[test]
    fn prefers_the_https_proxy() {
        assert_eq!(system_proxy(CLASH).as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn falls_back_to_socks() {
        let text = CLASH.replace("HTTPSEnable : 1", "HTTPSEnable : 0");
        assert_eq!(system_proxy(&text).as_deref(), Some("socks5h://127.0.0.1:7891"));
    }

    #[test]
    fn none_when_nothing_is_turned_on() {
        let text = "<dictionary> {\n  HTTPEnable : 0\n  HTTPSEnable : 0\n  ProxyAutoConfigEnable : 0\n}";
        assert_eq!(system_proxy(text), None);
    }

    #[test]
    fn none_when_the_port_is_missing() {
        let text = "<dictionary> {\n  HTTPSEnable : 1\n  HTTPSProxy : proxy.corp\n}";
        assert_eq!(system_proxy(text), None);
    }
}

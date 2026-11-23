//! Keeps every window on the app's own pages.
//!
//! WebKit opens a file or link dropped on a page that leaves the drag alone,
//! which replaced the pet with the dropped file's text. The pages handle their
//! drops; this catches whatever slips past them.

use tauri::{Runtime, Url, plugin::TauriPlugin};

/// Host of the installed app's pages: `tauri://localhost` (`http://tauri.localhost` where Tauri serves over http).
const APP_HOST: &str = "localhost";
const HTTP_APP_HOST: &str = "tauri.localhost";
/// Hosts of the dev server, allowed only in a debug build.
const DEV_HOSTS: [&str; 2] = ["localhost", "127.0.0.1"];

/// Whether a window may go to `url`: only the app's own pages, and the dev server when `dev`.
fn stays_in_app(url: &Url, dev: bool) -> bool {
    match url.scheme() {
        "about" => true,
        "tauri" => url.host_str() == Some(APP_HOST),
        "http" | "https" => url.host_str().is_some_and(|host| host == HTTP_APP_HOST || (dev && DEV_HOSTS.contains(&host))),
        _ => false,
    }
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_, url| {
            let allowed = stays_in_app(url, cfg!(debug_assertions));
            if !allowed {
                log::warn!("blocked a window from leaving the app (scheme {})", url.scheme());
            }
            allowed
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::stays_in_app;
    use tauri::Url;

    fn allowed(url: &str) -> bool {
        stays_in_app(&Url::parse(url).unwrap(), true)
    }

    fn allowed_installed(url: &str) -> bool {
        stays_in_app(&Url::parse(url).unwrap(), false)
    }

    #[test]
    fn the_apps_own_pages_load() {
        assert!(allowed("tauri://localhost/index.html?window=chat"));
        assert!(allowed("http://localhost:1420/?window=settings"));
        assert!(allowed("http://tauri.localhost/index.html"));
        assert!(allowed("about:blank"));
    }

    #[test]
    fn the_installed_app_loads_only_its_own_pages() {
        assert!(allowed_installed("tauri://localhost/index.html?window=chat"));
        assert!(allowed_installed("tauri://localhost/"));
        assert!(allowed_installed("about:blank"));
        assert!(!allowed_installed("http://localhost:1420/?window=settings"));
        assert!(!allowed_installed("http://127.0.0.1:8080/"));
    }

    #[test]
    fn dropped_files_and_links_do_not() {
        assert!(!allowed("file:///Users/me/Desktop/notes.md"));
        assert!(!allowed("https://example.com/"));
        assert!(!allowed("http://localhost.example.com/"));
        assert!(!allowed("tauri://example.com/index.html"));
        assert!(!allowed("tauri://other/"));
    }
}

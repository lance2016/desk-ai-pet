//! Keeps every window on the app's own pages.
//!
//! WebKit opens a file or link dropped on a page that leaves the drag alone,
//! which replaced the pet with the dropped file's text. The pages handle their
//! drops; this catches whatever slips past them.

use tauri::{Runtime, Url, plugin::TauriPlugin};

/// Hosts the app's pages are served from: `tauri://localhost` when installed,
/// the dev server while developing.
const APP_HOSTS: [&str; 3] = ["localhost", "tauri.localhost", "127.0.0.1"];

/// Whether a window may go to `url`: only the app's own pages.
fn stays_in_app(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" | "https" => url.host_str().is_some_and(|host| APP_HOSTS.contains(&host)),
        _ => false,
    }
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_, url| {
            let allowed = stays_in_app(url);
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
        stays_in_app(&Url::parse(url).unwrap())
    }

    #[test]
    fn the_apps_own_pages_load() {
        assert!(allowed("tauri://localhost/index.html?window=chat"));
        assert!(allowed("http://localhost:1420/?window=settings"));
        assert!(allowed("http://tauri.localhost/index.html"));
        assert!(allowed("about:blank"));
    }

    #[test]
    fn dropped_files_and_links_do_not() {
        assert!(!allowed("file:///Users/me/Desktop/notes.md"));
        assert!(!allowed("https://example.com/"));
        assert!(!allowed("http://localhost.example.com/"));
    }
}

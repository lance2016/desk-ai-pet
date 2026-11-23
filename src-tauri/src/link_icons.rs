//! Fetches page icon declarations and image bytes for saved links.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::{
    io::Read,
    process::{Command, Stdio},
};
use tauri::WebviewWindow;
use url::Url;

const MAX_URL_BYTES: usize = 2048;
const MAX_HEAD_BYTES: usize = 128 * 1024;
const MAX_ICON_BYTES: usize = 256 * 1024;
const MAX_TRAILER_BYTES: usize = 256;
const FETCH_TIMEOUT_SECONDS: &str = "5";

fn web_url(value: &str) -> Option<Url> {
    let mut url = Url::parse(value).ok()?;
    if value.len() > MAX_URL_BYTES
        || !matches!(url.scheme(), "http" | "https")
        || !url.has_host()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    url.set_fragment(None);
    Some(url)
}

fn can_fetch(window: &WebviewWindow) -> bool {
    matches!(window.label(), "links" | "settings")
}

/// A request never follows redirects, sends cookies or sends a referrer.
fn download(url: &Url, limit: usize) -> Option<(Vec<u8>, String)> {
    let mut child = Command::new("/usr/bin/curl")
        .arg("--disable")
        .args(crate::proxy::curl_args())
        .args([
            "--silent",
            "--globoff",
            "--proto",
            "=http,https",
            "--max-time",
            FETCH_TIMEOUT_SECONDS,
            "--max-filesize",
            &limit.to_string(),
            "--write-out",
            "\n%{http_code}\n%{content_type}",
            "--url",
            url.as_str(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let cap = limit + MAX_TRAILER_BYTES;
    let mut output = Vec::new();
    let read = child
        .stdout
        .take()
        .map(|stdout| stdout.take(cap as u64).read_to_end(&mut output));
    if !matches!(read, Some(Ok(_))) || output.len() == cap {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    }
    if !child.wait().ok()?.success() {
        return None;
    }
    let mut parts = output.rsplitn(3, |byte| *byte == b'\n');
    let mime = std::str::from_utf8(parts.next()?).ok()?.to_owned();
    let status: u16 = std::str::from_utf8(parts.next()?).ok()?.parse().ok()?;
    let bytes = parts.next()?;
    ((200..300).contains(&status) && bytes.len() <= limit).then(|| (bytes.to_vec(), mime))
}

#[derive(Serialize)]
pub struct IconPage {
    url: String,
    html: String,
}

#[tauri::command]
pub async fn link_icon_page(window: WebviewWindow, url: String) -> Option<IconPage> {
    if !can_fetch(&window) {
        return None;
    }
    let mut url = web_url(&url)?;
    url.set_query(None);
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, _) = download(&url, MAX_HEAD_BYTES)?;
        Some(IconPage {
            url: url.to_string(),
            html: String::from_utf8_lossy(&bytes).into_owned(),
        })
    })
    .await
    .ok()?
}

fn icon_mime(bytes: &[u8], content_type: &str) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"\x00\x00\x01\x00") {
        return Some("image/x-icon");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Some("image/webp");
    }
    (content_type
        .split(';')
        .next()?
        .trim()
        .eq_ignore_ascii_case("image/svg+xml"))
    .then_some("image/svg+xml")
}

#[tauri::command]
pub async fn link_icon_image(window: WebviewWindow, page: String, url: String) -> Option<String> {
    if !can_fetch(&window) {
        return None;
    }
    let page = web_url(&page)?;
    let url = web_url(&url)?;
    if url.origin() != page.origin() {
        return None;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, mime) = download(&url, MAX_ICON_BYTES)?;
        let mime = icon_mime(&bytes, &mime)?;
        Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    })
    .await
    .ok()?
}

//! The model channel. It keeps the API keys in the keychain, sends requests only to the
//! providers' fixed addresses, and passes the replies back. What to send and how to read
//! the reply is decided in `src/ai/`.

use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStderr, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

/// Must match `STREAM_EVENT` in `src/platform/llm.ts`.
const STREAM_EVENT: &str = "pet://llm-stream";
/// A full chat (30 messages) with one picture fits well within this.
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_REQUEST_ID_BYTES: usize = 100;
/// Seconds to wait for a connection, and for a stalled reply to send anything.
const CONNECT_TIMEOUT: &str = "10";
const STALL_SECONDS: &str = "30";
const STREAM_MAX_SECONDS: &str = "120";
const COMPLETE_MAX_SECONDS: &str = "20";
/// curl writes this and the HTTP status after the body (`write-out`), so a failure is
/// told by its status code, not by digits found in an error text.
const STATUS_MARKER: &str = "__ai_pet_http_status__";
const WRITE_OUT_STATUS: &str = "write-out = \"\\n__ai_pet_http_status__%{http_code}\\n\"\n";

/// A model service the app may send the user's key to. Must match `PROVIDERS` in `src/ai/providers.ts`.
struct Provider {
    id: &'static str,
    endpoint: &'static str,
    /// Last part of the keychain service name. Changing it loses the keys users saved.
    keychain: &'static str,
    /// Shown when a pasted key does not look like this provider's.
    bad_key: &'static str,
}

const PROVIDERS: [Provider; 1] = [Provider {
    id: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    keychain: "deepseek",
    bad_key: "API Key 格式不对。DeepSeek 的 Key 一般以 sk- 开头，中间没有空格和引号，请重新复制再粘贴。",
}];

fn provider(id: &str) -> Result<&'static Provider, String> {
    PROVIDERS.iter().find(|provider| provider.id == id).ok_or_else(|| "Unknown model provider".to_string())
}

fn service(app: &AppHandle, provider: &Provider) -> String {
    format!("{}.{}", app.config().identifier, provider.keychain)
}

struct Running {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
    /// Label of the window that asked; the reply streams back to it.
    window: String,
}

/// The streamed requests still running, by request id.
#[derive(Default)]
pub struct LlmState(Mutex<HashMap<String, Running>>);

impl LlmState {
    pub fn cancel_all(&self) {
        self.cancel_where(|_, _| true);
    }

    /// Stops the requests one window started, such as the translation panel when it closes.
    pub fn cancel_window(&self, label: &str) {
        self.cancel_where(|_, request| request.window == label);
    }

    fn cancel_where(&self, matches: impl Fn(&str, &Running) -> bool) {
        if let Ok(running) = self.0.lock() {
            for request in running.iter().filter(|(id, request)| matches(id, request)).map(|(_, request)| request) {
                request.cancelled.store(true, Ordering::Relaxed);
                if let Ok(mut child) = request.child.lock() {
                    let _ = child.kill();
                }
            }
        }
    }
}

#[tauri::command]
pub fn llm_key_status(app: AppHandle, provider: String) -> Result<bool, String> {
    crate::secrets::exists(&service(&app, self::provider(&provider)?))
}

#[tauri::command]
pub fn llm_save_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let provider = self::provider(&provider)?;
    let value = crate::secrets::clean_pasted_key(&key);
    if value.len() < 8 || value.len() > 256 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return Err(provider.bad_key.into());
    }
    crate::secrets::save(&service(&app, provider), &value)
}

#[tauri::command]
pub fn llm_clear_key(app: AppHandle, provider: String) -> Result<(), String> {
    crate::secrets::clear(&service(&app, self::provider(&provider)?))
}

fn check_request_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_REQUEST_ID_BYTES || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        return Err("Invalid request id".into());
    }
    Ok(())
}

/// The body as sent: a JSON object of bounded size.
fn request_body(body: &Value) -> Result<String, String> {
    if !body.is_object() {
        return Err("Invalid request body".into());
    }
    let text = body.to_string();
    if text.len() > MAX_BODY_BYTES {
        return Err("这条消息太长了，发不出去。".into());
    }
    Ok(text)
}

/// The key in the keychain, or the message the webview reads as "not configured".
fn load_key(app: &AppHandle, provider: &Provider) -> Result<String, String> {
    crate::secrets::load(&service(app, provider))?.ok_or_else(|| "API key is not configured".to_string())
}

fn config_quote(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r")
}

/// The status code on a `STATUS_MARKER` line; `Some(None)` when curl got no response at
/// all (it writes 000), `None` for any other line.
fn status_line(line: &str) -> Option<Option<u16>> {
    let code = line.trim().strip_prefix(STATUS_MARKER)?;
    Some(code.parse::<u16>().ok().filter(|code| *code != 0))
}

/// Starts curl for one request. The key and body go in through stdin, never the command line.
fn spawn_curl(provider: &Provider, key: &str, body: &str, limits: &[&str]) -> Result<Child, String> {
    let mut child = Command::new("/usr/bin/curl")
        .args(["--disable", "--config", "-", "--silent", "--show-error", "--fail-with-body", "--connect-timeout", CONNECT_TIMEOUT, "--proto", "=https"])
        .args(limits)
        .arg(provider.endpoint)
        .args(crate::proxy::curl_args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Cannot start the network request".to_string())?;
    let config = format!(
        "header = \"Authorization: Bearer {}\"\nheader = \"Content-Type: application/json\"\ndata = \"{}\"\n{WRITE_OUT_STATUS}",
        config_quote(key),
        config_quote(body)
    );
    if let Some(mut input) = child.stdin.take() {
        if input.write_all(config.as_bytes()).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Failed to start the network request".into());
        }
    }
    Ok(child)
}

fn emit(app: &AppHandle, window: &str, payload: Value) {
    let _ = app.emit_to(window, STREAM_EVENT, payload);
}

/// Sends one streamed request. Each `data:` line of the reply reaches the window that asked
/// as a `data` event, and an `end` event follows with the HTTP status.
#[tauri::command]
pub async fn llm_stream(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<LlmState>>,
    provider: String,
    request_id: String,
    body: Value,
) -> Result<(), String> {
    let provider = self::provider(&provider)?;
    check_request_id(&request_id)?;
    let body = request_body(&body)?;
    let state = state.inner().clone();
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || start_stream(app, label, state, provider, request_id, body))
        .await
        .map_err(|_| "Request task failed".to_string())?
}

fn start_stream(app: AppHandle, window: String, state: Arc<LlmState>, provider: &'static Provider, id: String, body: String) -> Result<(), String> {
    let key = load_key(&app, provider)?;
    let mut running = state.0.lock().map_err(|_| "Request state unavailable")?;
    if running.contains_key(&id) {
        return Err("Duplicate request id".into());
    }
    let mut child = spawn_curl(provider, &key, &body, &["--no-buffer", "--speed-limit", "1", "--speed-time", STALL_SECONDS, "--max-time", STREAM_MAX_SECONDS])?;
    let stdout = child.stdout.take().ok_or("Cannot read response")?;
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    running.insert(id.clone(), Running { child: child.clone(), cancelled: cancelled.clone(), window: window.clone() });
    drop(running);
    thread::spawn(move || {
        let status = forward_lines(BufReader::new(stdout), |data| {
            if !cancelled.load(Ordering::Relaxed) {
                emit(&app, &window, json!({"id": id, "kind": "data", "data": data}));
            }
        });
        let (ok, details) = finish(&child, stderr);
        if let Ok(mut running) = state.0.lock() {
            running.remove(&id);
        }
        let cancelled = cancelled.load(Ordering::Relaxed);
        if !cancelled && (!ok || !status.is_some_and(|code| (200..300).contains(&code))) && !details.trim().is_empty() {
            log::warn!("Model request failed ({status:?}): {}", details.trim());
        }
        emit(&app, &window, json!({"id": id, "kind": "end", "status": status, "ok": ok, "cancelled": cancelled}));
    });
    Ok(())
}

/// Hands on the payload of every `data:` line and returns the HTTP status that follows the body.
fn forward_lines(reader: impl BufRead, mut forward: impl FnMut(&str)) -> Option<u16> {
    let mut status = None;
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if let Some(code) = status_line(&line) {
            status = code;
        } else if let Some(data) = line.trim().strip_prefix("data:") {
            let data = data.trim();
            if !data.is_empty() {
                forward(data);
            }
        }
    }
    status
}

/// Waits for curl to exit; returns whether it succeeded and what it wrote to stderr.
fn finish(child: &Arc<Mutex<Child>>, stderr: Option<ChildStderr>) -> (bool, String) {
    let status = loop {
        match child.lock().ok().and_then(|mut process| process.try_wait().ok()) {
            Some(Some(status)) => break Some(status),
            Some(None) => thread::sleep(std::time::Duration::from_millis(50)),
            None => break None,
        }
    };
    let mut details = String::new();
    if let Some(mut stderr) = stderr {
        let _ = stderr.read_to_string(&mut details);
    }
    (status.is_some_and(|status| status.success()), details)
}

#[tauri::command]
pub fn llm_cancel(state: State<'_, Arc<LlmState>>, request_id: String) -> Result<(), String> {
    state.cancel_where(|id, _| id == request_id);
    Ok(())
}

/// Sends one request without streaming and returns the HTTP status and the reply body.
#[tauri::command]
pub async fn llm_complete(app: AppHandle, provider: String, body: Value) -> Result<Value, String> {
    let provider = self::provider(&provider)?;
    let body = request_body(&body)?;
    tauri::async_runtime::spawn_blocking(move || {
        let key = load_key(&app, provider)?;
        let child = spawn_curl(provider, &key, &body, &["--max-time", COMPLETE_MAX_SECONDS])?;
        let output = child.wait_with_output().map_err(|_| "Cannot read the reply".to_string())?;
        let (reply, status) = split_status(&String::from_utf8_lossy(&output.stdout));
        if !output.status.success() {
            log::warn!("Model request failed ({status:?}): {}", String::from_utf8_lossy(&output.stderr).trim());
        }
        Ok(json!({"status": status, "ok": output.status.success(), "body": reply}))
    })
    .await
    .map_err(|_| "Request task failed".to_string())?
}

/// The reply body and the HTTP status curl wrote after it.
fn split_status(output: &str) -> (String, Option<u16>) {
    match output.rfind(&format!("\n{STATUS_MARKER}")) {
        Some(at) => (output[..at].to_owned(), status_line(&output[at..]).flatten()),
        None => (output.to_owned(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn knows_only_its_providers() {
        assert_eq!(provider("deepseek").unwrap().endpoint, "https://api.deepseek.com/chat/completions");
        assert!(provider("https://example.com").is_err());
    }

    #[test]
    fn checks_request_ids_and_bodies() {
        assert!(check_request_id("a1-b2").is_ok());
        for bad in ["", "a b", "a/b", &"a".repeat(101)] {
            assert!(check_request_id(bad).is_err(), "{bad}");
        }
        assert!(request_body(&json!({"model": "m"})).is_ok());
        assert!(request_body(&json!([1])).is_err());
        assert!(request_body(&json!({"x": "a".repeat(MAX_BODY_BYTES)})).is_err());
    }

    #[test]
    fn forwards_data_lines_and_reads_the_status() {
        let mut seen = Vec::new();
        let input = ": keep-alive\ndata: {\"a\":1}\r\n\ndata: [DONE]\n\n__ai_pet_http_status__200\n";
        let status = forward_lines(Cursor::new(input), |data| seen.push(data.to_owned()));
        assert_eq!(seen, ["{\"a\":1}", "[DONE]"]);
        assert_eq!(status, Some(200));
        assert_eq!(forward_lines(Cursor::new("__ai_pet_http_status__000\n"), |_| {}), None);
    }

    #[test]
    fn splits_the_reply_from_the_status() {
        assert_eq!(split_status("{\"ok\":1}\n__ai_pet_http_status__401\n"), ("{\"ok\":1}".into(), Some(401)));
        assert_eq!(split_status("broken"), ("broken".into(), None));
    }

    #[test]
    fn escapes_config_metacharacters() {
        assert_eq!(config_quote("a\"b\\c\n"), "a\\\"b\\\\c\\n");
    }
}

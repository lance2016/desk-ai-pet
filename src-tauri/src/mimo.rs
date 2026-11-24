use serde_json::{Value, json};
use std::{
    collections::HashMap,
    collections::HashSet,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tauri::{AppHandle, Emitter, State, Window};

const ENDPOINT: &str = "https://api.xiaomimimo.com/v1/chat/completions";
const SPEECH_EVENT: &str = "pet://mimo-audio";
/// Key of the transcription in `MimoSpeechState`; one runs at a time, from the chat window.
const TRANSCRIBE_ID: &str = "transcribe";
/// Returned when the user cancelled the transcription; the webview says nothing for it.
const CANCELLED: &str = "cancelled";
const CONNECT_TIMEOUT: &str = "10";

pub(crate) struct RunningSpeech {
    pub(crate) child: Arc<Mutex<Child>>,
    pub(crate) cancelled: Arc<AtomicBool>,
    /// Label of the window that asked for it, so closing one window stops only its own requests.
    pub(crate) window: String,
}
#[derive(Default)]
pub struct MimoSpeechState {
    pub(crate) running: Mutex<HashMap<String, RunningSpeech>>,
    pending_cancelled: Mutex<HashSet<String>>,
}

impl MimoSpeechState {
    pub fn cancel_all(&self) {
        self.cancel_where(|_| true);
    }

    /// Stops the requests the window `label` started; other windows' keep going.
    pub fn cancel_window(&self, label: &str) {
        self.cancel_where(|request| request.window == label);
    }

    fn cancel_where(&self, matches: impl Fn(&RunningSpeech) -> bool) {
        if let Ok(running) = self.running.lock() {
            for request in running.values().filter(|request| matches(request)) {
                request.cancelled.store(true, Ordering::Relaxed);
                if let Ok(mut child) = request.child.lock() {
                    let _ = child.kill();
                }
            }
        }
    }

    /// Removes the request under `id` if it is still the one `cancelled` belongs to.
    pub(crate) fn forget(&self, id: &str, cancelled: &Arc<AtomicBool>) {
        if let Ok(mut running) = self.running.lock() {
            if running.get(id).is_some_and(|request| Arc::ptr_eq(&request.cancelled, cancelled)) {
                running.remove(id);
            }
        }
    }

    /// Registers the child atomically with pending cancellation so a stop during cloud setup is not lost.
    pub(crate) fn register(&self, id: String, request: RunningSpeech) -> Result<bool, String> {
        let mut pending = self.pending_cancelled.lock().map_err(|_| "语音请求状态不可用。".to_owned())?;
        if pending.remove(&id) {
            return Ok(false);
        }
        let mut running = self.running.lock().map_err(|_| "语音请求状态不可用。".to_owned())?;
        if running.contains_key(&id) {
            return Err("语音请求编号重复。".into());
        }
        running.insert(id, request);
        Ok(true)
    }

    pub(crate) fn cancel(&self, id: &str) -> Result<(), String> {
        let mut pending = self.pending_cancelled.lock().map_err(|_| "语音请求状态不可用。".to_owned())?;
        let running = self.running.lock().map_err(|_| "语音请求状态不可用。".to_owned())?;
        if let Some(request) = running.get(id) {
            request.cancelled.store(true, Ordering::Relaxed);
            if let Ok(mut child) = request.child.lock() { let _ = child.kill(); }
        } else if id.starts_with("read-") {
            pending.insert(id.to_owned());
        }
        Ok(())
    }

    pub(crate) fn clear_pending(&self, id: &str) {
        if let Ok(mut pending) = self.pending_cancelled.lock() { pending.remove(id); }
    }
}

/// Audio goes back to the window that asked for it: the chat reads replies, settings plays a sample.
pub(crate) fn emit_speech(app: &AppHandle, window: &str, id: &str, kind: &str, data: &str) {
    let _ = app.emit_to(
        window,
        SPEECH_EVENT,
        json!({"id":id,"kind":kind,"data":data}),
    );
}

const PROVIDER: &str = "mimo";

fn config_quote(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

#[tauri::command]
pub fn mimo_key_status(app: AppHandle) -> Result<bool, String> {
    Ok(crate::api_keys::store(&app)?.load(PROVIDER)?.is_some())
}

#[tauri::command]
pub fn mimo_save_key(app: AppHandle, key: String) -> Result<(), String> {
    let key = crate::secrets::clean_pasted_key(&key);
    if !(8..=256).contains(&key.len())
        || !key
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
    {
        return Err("API Key 格式不对。Key 中间没有空格和引号，请重新复制再粘贴。".into());
    }
    crate::api_keys::store(&app)?.save(PROVIDER, &key)
}

/// Stops a running transcription; `mimo_transcribe` then fails with `CANCELLED`.
#[tauri::command]
pub fn mimo_transcribe_cancel(state: State<'_, Arc<MimoSpeechState>>) -> Result<(), String> {
    mimo_speech_cancel(state, TRANSCRIBE_ID.into())
}

#[tauri::command]
pub fn mimo_clear_key(app: AppHandle) -> Result<(), String> {
    crate::api_keys::store(&app)?.clear(PROVIDER)
}

/// Sends one request and waits for the answer. It is registered in `state`
/// under `TRANSCRIBE_ID` as soon as curl starts, so the user can cancel it; one runs at a time.
fn request(app: &AppHandle, state: &MimoSpeechState, window: String, body: Value) -> Result<Value, String> {
    let key = crate::api_keys::store(app)?.load(PROVIDER)?.ok_or("请先在设置 → AI 服务中配置 MiMo API Key")?;
    // Held while curl starts, so the check and the registration are one step.
    let mut running = state.running.lock().map_err(|_| "语音请求状态不可用")?;
    if running.contains_key(TRANSCRIBE_ID) {
        return Err("上一段语音还在识别，请稍后再试。".into());
    }
    let mut child = Command::new("/usr/bin/curl")
        .args([
            "--disable",
            "--config",
            "-",
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--connect-timeout",
            CONNECT_TIMEOUT,
            "--max-time",
            "120",
            "--proto",
            "=https",
            ENDPOINT,
        ])
        .args(crate::proxy::curl_args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动 MiMo 请求".to_string())?;
    let input = child.stdin.take();
    let stdout = child.stdout.take();
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    running.insert(
        TRANSCRIBE_ID.into(),
        RunningSpeech { child: child.clone(), cancelled: cancelled.clone(), window },
    );
    drop(running);
    let config = format!(
        "header = \"api-key: {}\"\nheader = \"Content-Type: application/json\"\ndata = \"{}\"\nwrite-out = \"\\n%{{http_code}}\"\n",
        config_quote(&key),
        config_quote(&body.to_string())
    );
    let sent = input.is_some_and(|mut input| input.write_all(config.as_bytes()).is_ok());
    let mut raw = Vec::new();
    match stdout {
        Some(mut stdout) if sent => {
            let _ = stdout.read_to_end(&mut raw);
        }
        _ => {
            if let Ok(mut process) = child.lock() {
                let _ = process.kill();
            }
        }
    }
    let exit = child.lock().ok().and_then(|mut process| process.wait().ok());
    state.forget(TRANSCRIBE_ID, &cancelled);
    if cancelled.load(Ordering::Relaxed) {
        return Err(CANCELLED.into());
    }
    if !sent {
        return Err("无法发送 MiMo 请求".into());
    }
    let mut response = String::from_utf8_lossy(&raw).into_owned();
    let status = response
        .rfind('\n')
        .and_then(|index| response[index + 1..].trim().parse::<u16>().ok());
    if let Some(index) = response.rfind('\n') {
        response.truncate(index);
    }
    if !exit.is_some_and(|exit| exit.success()) || !status.is_some_and(|code| (200..300).contains(&code)) {
        let code = status.unwrap_or_default();
        return Err(match code {
            401 | 403 => "MiMo API Key 无效，请在设置中检查。".into(),
            402 => "MiMo 账户余额不足，请检查账户。".into(),
            429 => "MiMo 请求过于频繁，请稍后重试。".into(),
            _ => "MiMo 请求失败，请检查网络和服务状态。".into(),
        });
    }
    serde_json::from_str(&response).map_err(|_| "MiMo 返回了无法识别的数据".to_string())
}

#[tauri::command]
pub async fn mimo_transcribe(
    app: AppHandle,
    window: Window,
    state: State<'_, Arc<MimoSpeechState>>,
    audio_base64: String,
    format: String,
    language: String,
) -> Result<String, String> {
    if !matches!(format.as_str(), "wav" | "mp3")
        || !matches!(language.as_str(), "auto" | "zh" | "en")
    {
        return Err("录音格式或语言设置无效".into());
    }
    if audio_base64.is_empty()
        || audio_base64.len() > 10_000_000
        || !audio_base64
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'/' | b'='))
    {
        return Err("录音数据无效或超过 MiMo 允许的 10 MB 限制".into());
    }
    let state = state.inner().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let mime = if format == "wav" { "audio/wav" } else { "audio/mpeg" };
        let result = request(&app, &state, label, json!({
            "model": "mimo-v2.5-asr",
            "messages": [{"role":"user","content":[{"type":"input_audio","input_audio":{"data":format!("data:{mime};base64,{audio_base64}")}}]}],
            "asr_options": {"language": language}
        }))?;
        result.pointer("/choices/0/message/content").and_then(Value::as_str)
            .or_else(|| result.pointer("/choices/0/message/content/0/text").and_then(Value::as_str))
            .or_else(|| result.pointer("/choices/0/message/audio/transcript").and_then(Value::as_str))
            .or_else(|| result.pointer("/choices/0/text").and_then(Value::as_str))
            .map(str::trim).filter(|text| !text.is_empty())
            .map(str::to_owned).ok_or_else(|| "MiMo 没有识别出文字，请再试一次。".to_string())
    }).await.map_err(|_| "语音识别任务异常".to_string())?
}

#[tauri::command]
pub async fn mimo_synthesize(
    app: AppHandle,
    window: Window,
    state: State<'_, Arc<MimoSpeechState>>,
    request_id: String,
    text: String,
    voice: String,
    style: String,
) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > 100
        || !request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("语音请求编号无效".into());
    }
    if text.trim().is_empty() || text.chars().count() > 3_000 || style.chars().count() > 200 {
        return Err("朗读文字或语气描述无效".into());
    }
    let cloned = voice.strip_prefix(crate::cloned_voices::VOICE_PREFIX).map(str::to_owned);
    if cloned.is_none()
        && !matches!(
            voice.as_str(),
            "mimo_default" | "冰糖" | "茉莉" | "苏打" | "白桦" | "Mia" | "Chloe" | "Milo" | "Dean"
        )
    {
        return Err("暂不支持所选 MiMo 音色".into());
    }
    let state = state.inner().clone();
    let target = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let cancel_id = request_id.clone();
        if let Some(id) = cloned {
            let result = crate::cloned_voices::ensure_service_voice(&app, &id).and_then(|service_voice| {
                crate::cosyvoice::stream_synthesis(
                    app,
                    target,
                    state.clone(),
                    request_id,
                    text,
                    service_voice,
                    style,
                )
            });
            if result.is_err() { state.clear_pending(&cancel_id); }
            return result;
        }
        let messages = if style.trim().is_empty() {
            json!([{"role":"assistant","content":text}])
        } else {
            json!([{"role":"user","content":style},{"role":"assistant","content":text}])
        };
        let result = stream_synthesis(
            app,
            target,
            state.clone(),
            request_id,
            json!({
                "model":"mimo-v2.5-tts", "messages":messages,
                "audio":{"format":"pcm16","voice":voice}, "stream":true
            }),
        );
        if result.is_err() { state.clear_pending(&cancel_id); }
        result
    })
    .await
    .map_err(|_| "语音合成任务异常".to_string())?
}

fn stream_synthesis(
    app: AppHandle,
    window: String,
    state: Arc<MimoSpeechState>,
    request_id: String,
    body: Value,
) -> Result<(), String> {
    let key =
        crate::api_keys::store(&app)?.load(PROVIDER)?.ok_or("请先在设置 → AI 服务中配置 MiMo API Key")?;
    let mut child = Command::new("/usr/bin/curl")
        .args([
            "--disable",
            "--config",
            "-",
            "--silent",
            "--show-error",
            "--no-buffer",
            "--fail-with-body",
            "--max-time",
            "120",
            "--proto",
            "=https",
            ENDPOINT,
        ])
        .args(crate::proxy::curl_args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "无法启动 MiMo 语音请求".to_string())?;
    let input = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    // Registration is atomic with pending cancellation, including a stop during clone setup.
    let registered = match state.register(
        request_id.clone(),
        RunningSpeech { child: child.clone(), cancelled: cancelled.clone(), window: window.clone() },
    ) {
        Ok(registered) => registered,
        Err(error) => {
            if let Ok(mut process) = child.lock() { let _ = process.kill(); let _ = process.wait(); }
            return Err(error);
        }
    };
    if !registered {
        if let Ok(mut process) = child.lock() { let _ = process.kill(); let _ = process.wait(); }
        emit_speech(&app, &window, &request_id, "cancelled", "");
        return Ok(());
    }
    let config = format!(
        "header = \"api-key: {}\"\nheader = \"Content-Type: application/json\"\ndata = \"{}\"\n",
        config_quote(&key),
        config_quote(&body.to_string())
    );
    let sent = input.is_some_and(|mut input| input.write_all(config.as_bytes()).is_ok());
    let stdout = match stdout {
        Some(stdout) if sent => stdout,
        _ => {
            if let Ok(mut process) = child.lock() {
                let _ = process.kill();
                let _ = process.wait();
            }
            state.forget(&request_id, &cancelled);
            return Err(if sent { "无法读取 MiMo 语音流" } else { "无法发送 MiMo 语音请求" }.into());
        }
    };
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut chunks = 0usize;
        let mut response_error = false;
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else {
                        continue;
                    };
                    if data == "[DONE]" {
                        continue;
                    }
                    let Ok(packet) = serde_json::from_str::<Value>(data) else {
                        continue;
                    };
                    if packet.get("error").is_some() {
                        response_error = true;
                        continue;
                    }
                    if let Some(audio) = packet
                        .pointer("/choices/0/delta/audio/data")
                        .and_then(Value::as_str)
                        .filter(|audio| !audio.is_empty())
                    {
                        chunks += 1;
                        emit_speech(&app, &window, &request_id, "chunk", audio);
                    }
                }
            }
        }
        let status = loop {
            let result = child
                .lock()
                .ok()
                .and_then(|mut process| process.try_wait().ok());
            match result {
                Some(Some(status)) => break Some(status),
                Some(None) => thread::sleep(std::time::Duration::from_millis(30)),
                None => break None,
            }
        };
        let mut details = String::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_string(&mut details);
        }
        state.forget(&request_id, &cancelled);
        if cancelled.load(Ordering::Relaxed) {
            emit_speech(&app, &window, &request_id, "cancelled", "");
        } else if !response_error && chunks > 0 && status.is_some_and(|status| status.success()) {
            emit_speech(&app, &window, &request_id, "done", "");
        } else {
            let message = if details.contains("401") || details.contains("403") {
                "MiMo API Key 无效，请在设置中检查。"
            } else if details.contains("402") {
                "MiMo 账户余额不足，请检查账户。"
            } else if details.contains("429") {
                "MiMo 请求过于频繁，请稍后重试。"
            } else {
                "MiMo 语音流中断，请检查网络后重试。"
            };
            emit_speech(&app, &window, &request_id, "error", message);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn mimo_speech_cancel(
    state: State<'_, Arc<MimoSpeechState>>,
    request_id: String,
) -> Result<(), String> {
    state.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running(state: &MimoSpeechState, id: &str, window: &str) -> Arc<AtomicBool> {
        let child = Command::new("/bin/sleep").arg("30").spawn().expect("spawn sleep");
        let cancelled = Arc::new(AtomicBool::new(false));
        let request = RunningSpeech { child: Arc::new(Mutex::new(child)), cancelled: cancelled.clone(), window: window.into() };
        assert!(state.register(id.into(), request).expect("register"));
        cancelled
    }

    #[test]
    fn closing_one_window_stops_only_its_own_speech() {
        let state = MimoSpeechState::default();
        let chat = running(&state, "read-chat", "chat");
        let dubbing = running(&state, "read-dub", "dubbing");
        state.cancel_window("chat");
        assert!(chat.load(Ordering::Relaxed));
        assert!(!dubbing.load(Ordering::Relaxed));
        state.cancel_all();
        assert!(dubbing.load(Ordering::Relaxed));
        for request in state.running.lock().unwrap().values() {
            let _ = request.child.lock().unwrap().wait();
        }
    }
}

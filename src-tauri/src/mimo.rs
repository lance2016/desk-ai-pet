use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tauri::{AppHandle, Emitter, State};

const ENDPOINT: &str = "https://api.xiaomimimo.com/v1/chat/completions";
const SPEECH_EVENT: &str = "pet://mimo-audio";
/// Key of the transcription in `MimoSpeechState`; one runs at a time, from the chat window.
const TRANSCRIBE_ID: &str = "transcribe";
/// Returned when the user cancelled the transcription; the webview says nothing for it.
const CANCELLED: &str = "cancelled";
const CONNECT_TIMEOUT: &str = "10";

struct RunningSpeech {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}
#[derive(Default)]
pub struct MimoSpeechState(Mutex<HashMap<String, RunningSpeech>>);

impl MimoSpeechState {
    pub fn cancel_all(&self) {
        if let Ok(running) = self.0.lock() {
            for request in running.values() {
                request.cancelled.store(true, Ordering::Relaxed);
                if let Ok(mut child) = request.child.lock() {
                    let _ = child.kill();
                }
            }
        }
    }
}

fn emit_speech(app: &AppHandle, id: &str, kind: &str, data: &str) {
    let _ = app.emit_to(
        "chat",
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
/// under `TRANSCRIBE_ID`, so the user can cancel it.
fn request(app: &AppHandle, state: &MimoSpeechState, body: Value) -> Result<Value, String> {
    let key = crate::api_keys::store(app)?.load(PROVIDER)?.ok_or("请先在设置 → AI 服务中配置 MiMo API Key")?;
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
    let config = format!(
        "header = \"api-key: {}\"\nheader = \"Content-Type: application/json\"\ndata = \"{}\"\nwrite-out = \"\\n%{{http_code}}\"\n",
        config_quote(&key),
        config_quote(&body.to_string())
    );
    if let Some(mut input) = child.stdin.take() {
        if input.write_all(config.as_bytes()).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("无法发送 MiMo 请求".into());
        }
    }
    let mut stdout = child.stdout.take().ok_or("无法读取 MiMo 响应")?;
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    state.0.lock().map_err(|_| "语音请求状态不可用")?.insert(
        TRANSCRIBE_ID.into(),
        RunningSpeech { child: child.clone(), cancelled: cancelled.clone() },
    );
    let mut raw = Vec::new();
    let _ = stdout.read_to_end(&mut raw);
    let exit = child.lock().ok().and_then(|mut process| process.wait().ok());
    if let Ok(mut running) = state.0.lock() {
        running.remove(TRANSCRIBE_ID);
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err(CANCELLED.into());
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
    tauri::async_runtime::spawn_blocking(move || {
        let mime = if format == "wav" { "audio/wav" } else { "audio/mpeg" };
        let result = request(&app, &state, json!({
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
    if !matches!(
        voice.as_str(),
        "mimo_default" | "冰糖" | "茉莉" | "苏打" | "白桦" | "Mia" | "Chloe" | "Milo" | "Dean"
    ) {
        return Err("暂不支持所选 MiMo 音色".into());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let messages = if style.trim().is_empty() {
            json!([{"role":"assistant","content":text}])
        } else {
            json!([{"role":"user","content":style},{"role":"assistant","content":text}])
        };
        stream_synthesis(
            app,
            state,
            request_id,
            json!({
                "model":"mimo-v2.5-tts", "messages":messages,
                "audio":{"format":"pcm16","voice":voice}, "stream":true
            }),
        )
    })
    .await
    .map_err(|_| "语音合成任务异常".to_string())?
}

fn stream_synthesis(
    app: AppHandle,
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
    let config = format!(
        "header = \"api-key: {}\"\nheader = \"Content-Type: application/json\"\ndata = \"{}\"\n",
        config_quote(&key),
        config_quote(&body.to_string())
    );
    if let Some(mut input) = child.stdin.take() {
        if input.write_all(config.as_bytes()).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("无法发送 MiMo 语音请求".into());
        }
    }
    let stdout = child.stdout.take().ok_or("无法读取 MiMo 语音流")?;
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let mut running = state.0.lock().map_err(|_| "语音请求状态不可用")?;
    if running.contains_key(&request_id) {
        return Err("语音请求编号重复".into());
    }
    running.insert(
        request_id.clone(),
        RunningSpeech {
            child: child.clone(),
            cancelled: cancelled.clone(),
        },
    );
    drop(running);

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
                        emit_speech(&app, &request_id, "chunk", audio);
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
        if let Ok(mut running) = state.0.lock() {
            running.remove(&request_id);
        }
        if cancelled.load(Ordering::Relaxed) {
            emit_speech(&app, &request_id, "cancelled", "");
        } else if !response_error && chunks > 0 && status.is_some_and(|status| status.success()) {
            emit_speech(&app, &request_id, "done", "");
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
            emit_speech(&app, &request_id, "error", message);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn mimo_speech_cancel(
    state: State<'_, Arc<MimoSpeechState>>,
    request_id: String,
) -> Result<(), String> {
    if let Some(request) = state
        .0
        .lock()
        .map_err(|_| "语音请求状态不可用")?
        .get(&request_id)
    {
        request.cancelled.store(true, Ordering::Relaxed);
        if let Ok(mut child) = request.child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}

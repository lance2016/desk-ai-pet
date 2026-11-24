//! Aliyun Model Studio voice enrollment and streamed CosyVoice synthesis.
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
};
use tauri::AppHandle;

const PROVIDER: &str = "cosyvoice";
const ENROLLMENT_ENDPOINT: &str =
    "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";
const SPEECH_ENDPOINT: &str =
    "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";
const MODEL: &str = "cosyvoice-v3.5-flash";
const CONNECT_TIMEOUT: &str = "10";
const REQUEST_TIMEOUT: &str = "120";

fn key_error(status: u16, enrollment: bool) -> String {
    match status {
        401 | 403 => "阿里云百炼 API Key 无效或地域不匹配，请检查设置。".into(),
        402 => "阿里云百炼账户余额或调用额度不足，请检查控制台。".into(),
        429 => "阿里云百炼请求太频繁，请稍后再试。".into(),
        400 if enrollment => "阿里云没有接受这段录音，请检查录音是否清晰、格式是否支持。".into(),
        400 => "CosyVoice 朗读失败，请检查克隆音色和朗读文字。".into(),
        _ => "阿里云百炼请求失败，请检查网络和服务状态。".into(),
    }
}

fn valid_key(key: &str) -> bool {
    (8..=256).contains(&key.len())
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

#[tauri::command]
pub fn cosyvoice_key_status(app: AppHandle) -> Result<bool, String> {
    Ok(crate::api_keys::store(&app)?.load(PROVIDER)?.is_some())
}

#[tauri::command]
pub fn cosyvoice_save_key(app: AppHandle, key: String) -> Result<(), String> {
    let key = crate::secrets::clean_pasted_key(&key);
    if !valid_key(&key) {
        return Err("API Key 格式不对，请重新复制阿里云百炼的 API Key。".into());
    }
    crate::api_keys::store(&app)?.save(PROVIDER, &key)
}

#[tauri::command]
pub fn cosyvoice_clear_key(app: AppHandle) -> Result<(), String> {
    crate::api_keys::store(&app)?.clear(PROVIDER)
}

fn quote_config(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn read_key(app: &AppHandle) -> Result<String, String> {
    crate::api_keys::store(app)?
        .load(PROVIDER)?
        .ok_or_else(|| "请先在设置 → AI 服务中配置阿里云百炼 API Key。".to_owned())
}

fn curl_command(endpoint: &str, streaming: bool) -> Result<std::process::Child, String> {
    let mut command = Command::new("/usr/bin/curl");
    command.args([
        "--disable",
        "--config",
        "-",
        "--silent",
        "--show-error",
        "--fail-with-body",
        "--connect-timeout",
        CONNECT_TIMEOUT,
        "--max-time",
        REQUEST_TIMEOUT,
        "--proto",
        "=https",
    ]);
    if streaming {
        command.arg("--no-buffer");
    }
    command
        .args(crate::proxy::curl_args())
        .arg(endpoint)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动阿里云百炼请求。".to_owned())
}

fn request_json(
    app: &AppHandle,
    endpoint: &str,
    body: Value,
    enrollment: bool,
) -> Result<Value, String> {
    let key = read_key(app)?;
    let body = body.to_string();
    let config = format!(
        "header = \"Authorization: Bearer {}\"\nheader = \"Content-Type: application/json\"\ndata = \"{}\"\nwrite-out = \"\\n%{{http_code}}\"\n",
        quote_config(&key),
        quote_config(&body),
    );
    let mut child = curl_command(endpoint, false)?;
    let sent = child
        .stdin
        .take()
        .is_some_and(|mut input| input.write_all(config.as_bytes()).is_ok());
    if !sent {
        let _ = child.kill();
        let _ = child.wait();
        return Err("无法发送阿里云百炼请求。".into());
    }
    let mut raw = Vec::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_end(&mut raw);
    }
    let exit = child.wait().ok();
    let response = String::from_utf8_lossy(&raw);
    let (body, status) = response
        .rsplit_once('\n')
        .map(|(body, status)| (body, status.trim().parse::<u16>().unwrap_or_default()))
        .unwrap_or((response.as_ref(), 0));
    if !exit.is_some_and(|status| status.success()) || !(200..300).contains(&status) {
        return Err(key_error(status, enrollment));
    }
    let result: Value =
        serde_json::from_str(body).map_err(|_| "阿里云百炼返回了无法识别的数据。".to_owned())?;
    if result.get("code").is_some() && result.get("output").is_none() {
        return Err(key_error(400, enrollment));
    }
    Ok(result)
}

pub(crate) fn create_voice(
    app: &AppHandle,
    audio_data_url: &str,
    prefix: &str,
) -> Result<(String, String), String> {
    let response = request_json(
        app,
        ENROLLMENT_ENDPOINT,
        json!({
            "model": "voice-enrollment",
            "input": {
                "action": "create_voice",
                "target_model": MODEL,
                "prefix": prefix,
                "audio": audio_data_url,
                "max_prompt_audio_length": 20.0,
                "enable_preprocess": false,
                "enable_volume_normalization": "false"
            }
        }),
        true,
    )?;
    let voice_id = response
        .pointer("/output/voice_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "阿里云百炼没有返回克隆音色编号。".to_owned())?;
    let status = response
        .pointer("/output/status")
        .and_then(Value::as_str)
        .unwrap_or("DEPLOYING");
    if !matches!(status, "DEPLOYING" | "OK" | "UNDEPLOYED") {
        return Err("阿里云百炼返回了无法识别的音色状态。".into());
    }
    Ok((voice_id, status.to_owned()))
}

pub(crate) fn voice_status(app: &AppHandle, voice_id: &str) -> Result<String, String> {
    let response = request_json(
        app,
        ENROLLMENT_ENDPOINT,
        json!({"model":"voice-enrollment","input":{"action":"query_voice","voice_id":voice_id}}),
        true,
    )?;
    let status = response
        .pointer("/output/status")
        .and_then(Value::as_str)
        .ok_or_else(|| "阿里云百炼没有返回音色状态。".to_owned())?;
    match status {
        "DEPLOYING" | "OK" | "UNDEPLOYED" => Ok(status.to_owned()),
        _ => Err("阿里云百炼返回了无法识别的音色状态。".into()),
    }
}

pub(crate) fn delete_voice(app: &AppHandle, voice_id: &str) -> Result<(), String> {
    request_json(
        app,
        ENROLLMENT_ENDPOINT,
        json!({"model":"voice-enrollment","input":{"action":"delete_voice","voice_id":voice_id}}),
        false,
    )?;
    Ok(())
}

fn speech_config(key: &str, body: &Value) -> String {
    format!(
        "header = \"Authorization: Bearer {}\"\nheader = \"Content-Type: application/json\"\nheader = \"X-DashScope-SSE: enable\"\ndata = \"{}\"\nwrite-out = \"\\n%{{http_code}}\"\n",
        quote_config(key),
        quote_config(&body.to_string()),
    )
}

pub(crate) fn stream_synthesis(
    app: AppHandle,
    window: String,
    state: Arc<crate::mimo::MimoSpeechState>,
    request_id: String,
    text: String,
    voice_id: String,
    instruction: String,
) -> Result<(), String> {
    let key = read_key(&app)?;
    let mut input = json!({
        "text": text,
        "voice": voice_id,
        "format": "pcm",
        "sample_rate": 24000
    });
    if !instruction.trim().is_empty() {
        input["instruction"] = Value::String(instruction);
    }
    let body = json!({"model": MODEL, "input": input});
    let config = speech_config(&key, &body);
    let mut child = curl_command(SPEECH_ENDPOINT, true)?;
    let stdout = child.stdout.take();
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let registered = match state.register(
        request_id.clone(),
        crate::mimo::RunningSpeech {
            child: child.clone(),
            cancelled: cancelled.clone(),
        },
    ) {
        Ok(registered) => registered,
        Err(error) => {
            if let Ok(mut process) = child.lock() {
                let _ = process.kill();
                let _ = process.wait();
            }
            return Err(error);
        }
    };
    if !registered {
        if let Ok(mut process) = child.lock() {
            let _ = process.kill();
            let _ = process.wait();
        }
        crate::mimo::emit_speech(&app, &window, &request_id, "cancelled", "");
        return Ok(());
    }
    let sent = child
        .lock()
        .ok()
        .and_then(|mut process| process.stdin.take())
        .is_some_and(|mut input| input.write_all(config.as_bytes()).is_ok());
    let stdout = match stdout {
        Some(stdout) if sent => stdout,
        _ => {
            if let Ok(mut process) = child.lock() {
                let _ = process.kill();
                let _ = process.wait();
            }
            state.forget(&request_id, &cancelled);
            return Err("无法发送阿里云百炼语音请求。".into());
        }
    };

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut chunks = 0usize;
        let mut response_error = false;
        let mut status_code = 0u16;
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if let Ok(status) = trimmed.parse::<u16>() {
                        status_code = status;
                        continue;
                    }
                    let Some(data) = trimmed.strip_prefix("data:").map(str::trim) else {
                        continue;
                    };
                    if data == "[DONE]" {
                        continue;
                    }
                    let Ok(packet) = serde_json::from_str::<Value>(data) else {
                        continue;
                    };
                    if (packet.get("code").is_some() || packet.get("error").is_some())
                        && packet.get("output").is_none()
                    {
                        response_error = true;
                        continue;
                    }
                    if let Some(audio) = packet
                        .pointer("/output/audio/data")
                        .and_then(Value::as_str)
                        .filter(|audio| !audio.is_empty())
                    {
                        chunks += 1;
                        crate::mimo::emit_speech(&app, &window, &request_id, "chunk", audio);
                    }
                }
            }
        }
        let exit = child
            .lock()
            .ok()
            .and_then(|mut process| process.wait().ok());
        state.forget(&request_id, &cancelled);
        if cancelled.load(Ordering::Relaxed) {
            crate::mimo::emit_speech(&app, &window, &request_id, "cancelled", "");
        } else if exit.is_some_and(|status| status.success())
            && (200..300).contains(&status_code)
            && !response_error
            && chunks > 0
        {
            crate::mimo::emit_speech(&app, &window, &request_id, "done", "");
        } else {
            crate::mimo::emit_speech(
                &app,
                &window,
                &request_id,
                "error",
                &key_error(status_code, false),
            );
        }
    });
    Ok(())
}

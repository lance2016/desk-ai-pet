//! Local metadata and reference samples for voices enrolled with CosyVoice.
use base64::{Engine, engine::general_purpose::STANDARD};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const FOLDER: &str = "voices-v1";
const INDEX: &str = "index.json";
pub const VOICE_PREFIX: &str = "clone:";
const MAX_SAMPLE_BASE64: usize = 4_000_000;
const MAX_VOICES: usize = 10;
const MAX_NAME_CHARS: usize = 20;
const ID_BYTES: usize = 8;
const STORAGE_ERROR: &str = "克隆的声音没能读写，请检查应用数据目录的访问权限。";
const REJECTED: &str = "阿里云未通过这个克隆音色的审核，请换一段清晰、无背景音乐的录音再试。";

/// Serializes voice enrollment and local index updates so concurrent requests cannot create duplicates.
static VOICE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClonedVoice {
    pub id: String,
    pub name: String,
    pub format: String,
    pub seconds: f64,
    pub created_at: u64,
    /// The CosyVoice model the cloud voice is bound to; it can only be read with this model.
    #[serde(default = "default_model")]
    pub model: String,
    /// Missing for voices saved by older releases until their first CosyVoice use.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_voice_id: Option<String>,
    /// Cloud voice readiness; absent for clones made before CosyVoice migration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_status: Option<String>,
}

fn default_model() -> String {
    crate::cosyvoice::DEFAULT_MODEL.to_owned()
}

fn check_model(model: &str) -> Result<(), String> {
    if crate::cosyvoice::MODELS.contains(&model) {
        Ok(())
    } else {
        Err("不支持这个克隆模型，请重新选择。".into())
    }
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FOLDER))
        .map_err(|_| STORAGE_ERROR.to_owned())
}

fn read_index(dir: &PathBuf) -> Result<Vec<ClonedVoice>, String> {
    match fs::read(dir.join(INDEX)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| STORAGE_ERROR.to_owned()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err(STORAGE_ERROR.to_owned()),
    }
}

fn write_index(dir: &PathBuf, voices: &[ClonedVoice]) -> Result<(), String> {
    let bytes = serde_json::to_vec(voices).map_err(|_| STORAGE_ERROR)?;
    crate::system::write_whole(&dir.join(INDEX), &bytes).map_err(|_| STORAGE_ERROR.to_owned())
}

fn valid_id(id: &str) -> bool {
    id.len() == ID_BYTES * 2
        && id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

fn sample_mime(format: &str, head: &[u8]) -> Option<&'static str> {
    match format {
        "wav" if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WAVE" => {
            Some("audio/wav")
        }
        "mp3"
            if head.starts_with(b"ID3")
                || (head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0) =>
        {
            Some("audio/mpeg")
        }
        _ => None,
    }
}

fn check_sample(
    name: &str,
    audio_base64: &str,
    format: &str,
    seconds: f64,
) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("声音的名字要在 1 到 {MAX_NAME_CHARS} 个字之间。"));
    }
    if audio_base64.is_empty() || audio_base64.len() > MAX_SAMPLE_BASE64 {
        return Err("声音片段太大了，请用 30 秒以内的录音。".into());
    }
    if !seconds.is_finite() || !(3.0..=30.0).contains(&seconds) {
        return Err("声音片段的时长不对，请重新录一段。".into());
    }
    let head = STANDARD
        .decode(
            audio_base64
                .get(..audio_base64.len().min(16))
                .unwrap_or_default(),
        )
        .map_err(|_| "声音片段读不出来，请换一个 wav 或 mp3 文件。".to_string())?;
    if STANDARD.decode(audio_base64).is_err() || sample_mime(format, &head).is_none() {
        return Err("只支持 wav 和 mp3 格式的声音片段。".into());
    }
    Ok(name.to_owned())
}

fn data_url(format: &str) -> &'static str {
    if format == "mp3" {
        "audio/mpeg"
    } else {
        "audio/wav"
    }
}

fn make_data_url(format: &str, sample: &str) -> String {
    format!("data:{};base64,{sample}", data_url(format))
}

/// Creates the cloud voice and returns its ID and status, removing it again when Aliyun rejects it.
fn enroll(
    app: &AppHandle,
    id: &str,
    format: &str,
    sample: &str,
    model: &str,
) -> Result<(String, String), String> {
    let prefix = format!("ap{}", &id[..8]);
    let (service_voice_id, created_status) =
        crate::cosyvoice::create_voice(app, &make_data_url(format, sample), &prefix, model)?;
    let service_status =
        crate::cosyvoice::voice_status(app, &service_voice_id).unwrap_or(created_status);
    if service_status == "UNDEPLOYED" {
        let _ = crate::cosyvoice::delete_voice(app, &service_voice_id);
        return Err(REJECTED.into());
    }
    Ok((service_voice_id, service_status))
}

fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; ID_BYTES];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| STORAGE_ERROR.to_owned())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn add_voice(
    app: AppHandle,
    name: String,
    audio_base64: String,
    format: String,
    seconds: f64,
    model: String,
) -> Result<ClonedVoice, String> {
    let name = check_sample(&name, &audio_base64, &format, seconds)?;
    check_model(&model)?;
    let _guard = VOICE_LOCK.lock().map_err(|_| STORAGE_ERROR.to_owned())?;
    let dir = folder(&app)?;
    let voices = read_index(&dir)?;
    if voices.len() >= MAX_VOICES {
        return Err(format!(
            "最多存 {MAX_VOICES} 个克隆的声音，先删掉一个再添加。"
        ));
    }

    let id = new_id()?;
    let (service_voice_id, service_status) = enroll(&app, &id, &format, &audio_base64, &model)?;
    if let Err(_) = fs::create_dir_all(&dir) {
        let _ = crate::cosyvoice::delete_voice(&app, &service_voice_id);
        return Err(STORAGE_ERROR.to_owned());
    }
    if crate::system::write_whole(&dir.join(format!("{id}.b64")), audio_base64.as_bytes()).is_err()
    {
        let _ = crate::cosyvoice::delete_voice(&app, &service_voice_id);
        return Err(STORAGE_ERROR.to_owned());
    }

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .unwrap_or_default();
    let voice = ClonedVoice {
        id: id.clone(),
        name,
        format,
        seconds,
        created_at,
        model,
        service_voice_id: Some(service_voice_id.clone()),
        service_status: Some(service_status),
    };
    let mut updated = voices;
    updated.push(voice.clone());
    if let Err(error) = write_index(&dir, &updated) {
        let _ = fs::remove_file(dir.join(format!("{id}.b64")));
        let _ = crate::cosyvoice::delete_voice(&app, &service_voice_id);
        return Err(error);
    }
    Ok(voice)
}

/// Leaves out voices the saved API Key cannot see, such as ones made under a replaced key.
/// Any other failure (offline, no key) keeps the voice.
fn visible_voices(app: &AppHandle, voices: Vec<ClonedVoice>) -> Vec<ClonedVoice> {
    let missing: Vec<bool> = std::thread::scope(|scope| {
        let checks: Vec<_> = voices
            .iter()
            .map(|voice| {
                scope.spawn(move || {
                    voice.service_voice_id.as_deref().is_some_and(|service_voice_id| {
                        crate::cosyvoice::voice_status(app, service_voice_id)
                            .is_err_and(|error| error == crate::cosyvoice::MISSING_VOICE)
                    })
                })
            })
            .collect();
        checks.into_iter().map(|check| check.join().unwrap_or(false)).collect()
    });
    voices
        .into_iter()
        .zip(missing)
        .filter_map(|(voice, missing)| (!missing).then_some(voice))
        .collect()
}

#[tauri::command]
pub async fn cloned_voice_list(app: AppHandle) -> Result<Vec<ClonedVoice>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let voices = read_index(&folder(&app)?)?;
        Ok(visible_voices(&app, voices))
    })
    .await
    .map_err(|_| "声音列表读取任务异常".to_owned())?
}

#[tauri::command]
pub async fn cloned_voice_add(
    app: AppHandle,
    name: String,
    audio_base64: String,
    format: String,
    seconds: f64,
    model: String,
) -> Result<ClonedVoice, String> {
    tauri::async_runtime::spawn_blocking(move || {
        add_voice(app, name, audio_base64, format, seconds, model)
    })
    .await
    .map_err(|_| "声音创建任务异常".to_owned())?
}

fn remove_voice(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("找不到这个克隆的声音。".into());
    }
    let _guard = VOICE_LOCK.lock().map_err(|_| STORAGE_ERROR.to_owned())?;
    let dir = folder(&app)?;
    let mut voices = read_index(&dir)?;
    let service_voice_id = voices
        .iter()
        .find(|voice| voice.id == id)
        .ok_or_else(|| "找不到这个克隆的声音。".to_owned())?
        .service_voice_id
        .clone();
    if let Some(service_voice_id) = service_voice_id {
        crate::cosyvoice::delete_voice(&app, &service_voice_id)?;
    }
    voices.retain(|voice| voice.id != id);
    write_index(&dir, &voices)?;
    match fs::remove_file(dir.join(format!("{id}.b64"))) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => {
            log::warn!("Could not delete a cloned voice sample: {error}");
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn cloned_voice_remove(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || remove_voice(app, id))
        .await
        .map_err(|_| "声音删除任务异常".to_owned())?
}

/// Clones the saved sample again for another model, then removes the cloud voice of the old one.
fn switch_model(app: AppHandle, id: String, model: String) -> Result<ClonedVoice, String> {
    if !valid_id(&id) {
        return Err("找不到这个克隆的声音。".into());
    }
    check_model(&model)?;
    let _guard = VOICE_LOCK.lock().map_err(|_| STORAGE_ERROR.to_owned())?;
    let dir = folder(&app)?;
    let mut voices = read_index(&dir)?;
    let position = voices
        .iter()
        .position(|voice| voice.id == id)
        .ok_or_else(|| "找不到这个克隆的声音。".to_owned())?;
    if voices[position].model == model {
        return Ok(voices[position].clone());
    }
    let sample = fs::read_to_string(dir.join(format!("{id}.b64")))
        .map_err(|_| "找不到原来的录音，请删掉这个声音再重新添加。".to_owned())?;
    let format = voices[position].format.clone();
    let (service_voice_id, service_status) = enroll(&app, &id, &format, &sample, &model)?;
    let old_service_voice = voices[position].service_voice_id.replace(service_voice_id.clone());
    voices[position].service_status = Some(service_status);
    voices[position].model = model;
    if let Err(error) = write_index(&dir, &voices) {
        let _ = crate::cosyvoice::delete_voice(&app, &service_voice_id);
        return Err(error);
    }
    if let Some(old) = old_service_voice {
        if let Err(error) = crate::cosyvoice::delete_voice(&app, &old) {
            log::warn!("Could not delete the cloud voice of the previous model: {error}");
        }
    }
    Ok(voices[position].clone())
}

#[tauri::command]
pub async fn cloned_voice_switch_model(
    app: AppHandle,
    id: String,
    model: String,
) -> Result<ClonedVoice, String> {
    tauri::async_runtime::spawn_blocking(move || switch_model(app, id, model))
        .await
        .map_err(|_| "换模型任务异常".to_owned())?
}

/// Enrolls a voice saved by an older release the first time the user reads with it.
/// Returns the cloud voice ID and the model it must be read with.
pub fn ensure_service_voice(app: &AppHandle, id: &str) -> Result<(String, String), String> {
    if !valid_id(id) {
        return Err("找不到这个克隆的声音，请重新添加。".into());
    }
    let _guard = VOICE_LOCK.lock().map_err(|_| STORAGE_ERROR.to_owned())?;
    let dir = folder(app)?;
    let mut voices = read_index(&dir)?;
    let position = voices
        .iter()
        .position(|voice| voice.id == id)
        .ok_or_else(|| "这个克隆的声音已经删除，请重新添加。".to_owned())?;
    let model = voices[position].model.clone();
    if let Some(service_voice_id) = voices[position].service_voice_id.clone() {
        if voices[position].service_status.as_deref() == Some("OK") {
            return Ok((service_voice_id, model));
        }
        match crate::cosyvoice::voice_status(app, &service_voice_id)?.as_str() {
            "OK" => {
                voices[position].service_status = Some("OK".into());
                write_index(&dir, &voices)?;
                return Ok((service_voice_id, model));
            }
            "DEPLOYING" => return Err("这个克隆音色还在阿里云审核或处理中，请稍后再试听。".into()),
            "UNDEPLOYED" => {
                voices[position].service_status = Some("UNDEPLOYED".into());
                write_index(&dir, &voices)?;
                return Err("阿里云未通过这个克隆音色的审核，请重新添加一段清晰的录音。".into());
            }
            _ => return Err("阿里云百炼返回了无法识别的音色状态。".into()),
        }
    }

    let sample = fs::read_to_string(dir.join(format!("{id}.b64")))
        .map_err(|_| "找不到原来的录音，请重新添加这个克隆的声音。".to_owned())?;
    let format = voices[position].format.clone();
    let (service_voice_id, service_status) = enroll(app, id, &format, &sample, &model)?;
    voices[position].service_voice_id = Some(service_voice_id.clone());
    voices[position].service_status = Some(service_status.clone());
    if let Err(error) = write_index(&dir, &voices) {
        let _ = crate::cosyvoice::delete_voice(app, &service_voice_id);
        return Err(error);
    }
    if service_status == "DEPLOYING" {
        return Err("这个克隆音色已提交到阿里云，审核或处理完成后再试听。".into());
    }
    Ok((service_voice_id, model))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voices_saved_before_the_model_choice_read_as_flash() {
        let saved = r#"[{"id":"1254182bada45b28","name":"a","format":"wav","seconds":13.6,"createdAt":1,"serviceVoiceId":"cosyvoice-v3.5-flash-ap1254182b-x","serviceStatus":"OK"}]"#;
        let voices: Vec<ClonedVoice> = serde_json::from_str(saved).unwrap();
        assert_eq!(voices[0].model, "cosyvoice-v3.5-flash");
    }

    #[test]
    fn only_listed_models_are_accepted() {
        assert!(check_model("cosyvoice-v3.5-plus").is_ok());
        assert!(check_model("cosyvoice-v3.5-flash").is_ok());
        assert!(check_model("cosyvoice-v3-plus").is_err());
        assert!(check_model("").is_err());
    }
}

//! Voice samples the user cloned with MiMo. Each sample is kept on this computer
//! as its base64 text and sent with every read-aloud that uses it; MiMo keeps nothing.
use base64::{Engine, engine::general_purpose::STANDARD};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const FOLDER: &str = "voices-v1";
const INDEX: &str = "index.json";
/// How a cloned voice is named in the voice preferences; `CLONED_VOICE_PREFIX` in `src/types.ts`.
pub const VOICE_PREFIX: &str = "clone:";
/// The curl config line that carries the request must stay well under curl's 10 MB line limit.
const MAX_SAMPLE_BASE64: usize = 4_000_000;
const MAX_VOICES: usize = 10;
const MAX_NAME_CHARS: usize = 20;
const ID_BYTES: usize = 8;
const STORAGE_ERROR: &str = "克隆的声音没能读写，请检查应用数据目录的访问权限。";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClonedVoice {
    id: String,
    name: String,
    format: String,
    seconds: f64,
    created_at: u64,
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
    id.len() == ID_BYTES * 2 && id.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// The MIME type MiMo expects for a sample in `format`, if the bytes really are that format.
fn sample_mime(format: &str, head: &[u8]) -> Option<&'static str> {
    match format {
        "wav" if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WAVE" => Some("audio/wav"),
        "mp3" if head.starts_with(b"ID3") || (head.len() >= 2 && head[0] == 0xFF && head[1] & 0xE0 == 0xE0) => {
            Some("audio/mpeg")
        }
        _ => None,
    }
}

/// Checks a sample before it is kept. Returns the cleaned name.
fn check_sample(name: &str, audio_base64: &str, format: &str, seconds: f64) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("声音的名字要在 1 到 {MAX_NAME_CHARS} 个字之间。"));
    }
    if audio_base64.is_empty() || audio_base64.len() > MAX_SAMPLE_BASE64 {
        return Err("声音片段太大了，请用 30 秒以内的录音。".into());
    }
    if !seconds.is_finite() || !(0.0..=600.0).contains(&seconds) {
        return Err("声音片段的时长不对，请重新录一段。".into());
    }
    let head = STANDARD
        .decode(audio_base64.get(..audio_base64.len().min(16)).unwrap_or_default())
        .map_err(|_| "声音片段读不出来，请换一个 wav 或 mp3 文件。".to_string())?;
    if STANDARD.decode(audio_base64).is_err() || sample_mime(format, &head).is_none() {
        return Err("只支持 wav 和 mp3 格式的声音片段。".into());
    }
    Ok(name.to_owned())
}

#[tauri::command]
pub fn mimo_voice_list(app: AppHandle) -> Result<Vec<ClonedVoice>, String> {
    read_index(&folder(&app)?)
}

#[tauri::command]
pub fn mimo_voice_add(
    app: AppHandle,
    name: String,
    audio_base64: String,
    format: String,
    seconds: f64,
) -> Result<ClonedVoice, String> {
    let name = check_sample(&name, &audio_base64, &format, seconds)?;
    let dir = folder(&app)?;
    fs::create_dir_all(&dir).map_err(|_| STORAGE_ERROR)?;
    let mut voices = read_index(&dir)?;
    if voices.len() >= MAX_VOICES {
        return Err(format!("最多存 {MAX_VOICES} 个克隆的声音，先删掉一个再添加。"));
    }
    let mut bytes = [0u8; ID_BYTES];
    SystemRandom::new().fill(&mut bytes).map_err(|_| STORAGE_ERROR)?;
    let id: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    crate::system::write_whole(&dir.join(format!("{id}.b64")), audio_base64.as_bytes())
        .map_err(|_| STORAGE_ERROR)?;
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .unwrap_or_default();
    let voice = ClonedVoice { id, name, format, seconds, created_at };
    voices.push(voice.clone());
    if let Err(error) = write_index(&dir, &voices) {
        let _ = fs::remove_file(dir.join(format!("{}.b64", voice.id)));
        return Err(error);
    }
    Ok(voice)
}

#[tauri::command]
pub fn mimo_voice_remove(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("找不到这个克隆的声音。".into());
    }
    let dir = folder(&app)?;
    let voices: Vec<ClonedVoice> = read_index(&dir)?.into_iter().filter(|voice| voice.id != id).collect();
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

/// The sample of a cloned voice as the data URL MiMo takes in `audio.voice`.
pub fn sample_data_url(app: &AppHandle, id: &str) -> Result<String, String> {
    const MISSING: &str = "这个克隆的声音已经删掉了，请在设置 → AI 服务里换一个声音。";
    if !valid_id(id) {
        return Err(MISSING.into());
    }
    let dir = folder(app)?;
    let voice = read_index(&dir)?.into_iter().find(|voice| voice.id == id).ok_or(MISSING)?;
    let sample = fs::read_to_string(dir.join(format!("{id}.b64"))).map_err(|_| MISSING)?;
    let mime = if voice.format == "mp3" { "audio/mpeg" } else { "audio/wav" };
    Ok(format!("data:{mime};base64,{sample}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WAV: &[u8] = b"RIFF\x24\x00\x00\x00WAVEfmt ";

    #[test]
    fn keeps_wav_and_mp3_and_refuses_anything_else() {
        let wav = STANDARD.encode(WAV);
        assert_eq!(check_sample(" 我的声音 ", &wav, "wav", 5.0).unwrap(), "我的声音");
        let mp3 = STANDARD.encode(b"ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00");
        assert!(check_sample("a", &mp3, "mp3", 5.0).is_ok());
        assert!(check_sample("a", &wav, "mp3", 5.0).is_err());
        assert!(check_sample("a", &STANDARD.encode(b"<html>not audio!"), "wav", 5.0).is_err());
        assert!(check_sample("a", "not base64 at all!", "wav", 5.0).is_err());
        assert!(check_sample("a", "AAAAAAAAAAAAAAA声音片段", "wav", 5.0).is_err());
    }

    #[test]
    fn refuses_bad_names_sizes_and_lengths() {
        let wav = STANDARD.encode(WAV);
        assert!(check_sample("  ", &wav, "wav", 5.0).is_err());
        assert!(check_sample(&"字".repeat(MAX_NAME_CHARS + 1), &wav, "wav", 5.0).is_err());
        assert!(check_sample("a", &wav, "wav", f64::NAN).is_err());
        assert!(check_sample("a", &"A".repeat(MAX_SAMPLE_BASE64 + 4), "wav", 5.0).is_err());
    }

    #[test]
    fn ids_are_lowercase_hex_of_the_right_length() {
        assert!(valid_id("0123456789abcdef"));
        assert!(!valid_id("0123456789ABCDEF"));
        assert!(!valid_id("../../etc/passwd"));
        assert!(!valid_id("0123"));
    }
}

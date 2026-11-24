//! The dubbing tool: turns a script into audio with a chosen voice. Its window is made when
//! opened and destroyed when closed, so it costs nothing while unused. The page synthesizes
//! through the read-aloud commands and hands the finished WAV here to be saved.
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
    ipc::{InvokeBody, Request},
};
use tauri_plugin_dialog::DialogExt;

/// Window label; also the `window=` route in `src/main.tsx` and an entry in `capabilities/default.json`.
pub const WINDOW: &str = "dubbing";
const URL: &str = "index.html?window=dubbing";
const TITLE: &str = "AI Pet 配音";
const SIZE: (f64, f64) = (900.0, 640.0);
const MIN_SIZE: (f64, f64) = (680.0, 480.0);
/// Thirty minutes of 24 kHz 16-bit mono plus the header; `MAX_EXPORT_SECONDS` in `src/dubbing/wav.ts` stops the page first.
const MAX_AUDIO_BYTES: usize = 30 * 60 * 48_000 + WAV_HEADER_BYTES;
const WAV_HEADER_BYTES: usize = 44;
const MAX_SUBTITLE_BYTES: usize = 2_000_000;
/// Must match `FORMAT_HEADER` in `src/platform/dubbing.ts`.
const FORMAT_HEADER: &str = "x-dubbing-format";
/// The highest AAC rate `afconvert` takes for 24 kHz mono; 96 kbps fails with '!dat'.
const AAC_BITRATE: &str = "64000";
const DEFAULT_NAME: &str = "配音";

/// Where the last audio export went, so its subtitles are saved beside it.
#[derive(Default)]
pub struct LastExport(Mutex<Option<PathBuf>>);

#[derive(Clone, Copy, Debug, PartialEq)]
enum Format {
    Wav,
    M4a,
}

impl Format {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "wav" => Some(Self::Wav),
            "m4a" => Some(Self::M4a),
            _ => None,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Wav => "wav",
            Self::M4a => "m4a",
        }
    }
}

/// Shows the dubbing window, making it first if it is not open.
pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.unminimize();
        window.show().map_err(|error| error.to_string())?;
        return window.set_focus().map_err(|error| error.to_string());
    }
    let window = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App(URL.into()))
        .title(TITLE)
        .inner_size(SIZE.0, SIZE.1)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            // Segments still being made would only be thrown away now.
            if let Some(state) = handle.try_state::<Arc<crate::mimo::MimoSpeechState>>() {
                state.cancel_window(WINDOW);
            }
            if let Err(error) = crate::sync_activation_policy(&handle, Some(WINDOW)) {
                log::warn!("failed to update the activation policy: {error}");
            }
        }
    });
    crate::sync_activation_policy(app, None).map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

/// Closes the window if it is open; used when the tool is turned off.
pub fn close(app: &AppHandle) -> Result<(), String> {
    match app.get_webview_window(WINDOW) {
        Some(window) => window.close().map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

fn check_wav(audio: &[u8]) -> Result<(), String> {
    let shaped = audio.len() > WAV_HEADER_BYTES
        && audio.len() <= MAX_AUDIO_BYTES
        && audio.starts_with(b"RIFF")
        && audio.get(8..12) == Some(b"WAVE".as_slice());
    if shaped { Ok(()) } else { Err("音频数据无效，或者超过了 30 分钟。".into()) }
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Writes the WAV as it is, or converts it to AAC with the system's `afconvert`.
fn write_audio(path: &Path, audio: &[u8], format: Format) -> Result<(), String> {
    if format == Format::Wav {
        return crate::system::write_whole(path, audio).map_err(|error| {
            log::warn!("failed to write dubbing audio: {error}");
            "音频没能保存，请换个位置再试。".to_owned()
        });
    }
    let source = std::env::temp_dir().join(format!("ai-pet-dubbing-{}.wav", std::process::id()));
    std::fs::write(&source, audio).map_err(|error| {
        log::warn!("failed to write the dubbing temporary file: {error}");
        "音频没能保存，请稍后再试。".to_owned()
    })?;
    let converted = Command::new("/usr/bin/afconvert")
        .args(["-f", "m4af", "-d", "aac", "-b", AAC_BITRATE])
        .arg(&source)
        .arg(path)
        .status();
    let _ = std::fs::remove_file(&source);
    match converted {
        Ok(status) if status.success() => Ok(()),
        other => {
            log::warn!("afconvert failed: {other:?}");
            Err("没能转成 M4A，可以先导出 WAV。".into())
        }
    }
}

/// Asks where to save the WAV in the request body (`FORMAT_HEADER` says which format to save
/// it as) and saves it there. Returns the file name, or nothing when the user cancels.
#[tauri::command]
pub async fn dubbing_export(
    app: AppHandle,
    last: State<'_, LastExport>,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    let format = request
        .headers()
        .get(FORMAT_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(Format::parse)
        .ok_or("导出格式无效。")?;
    let InvokeBody::Raw(audio) = request.body() else {
        return Err("音频数据无效。".into());
    };
    check_wav(audio)?;
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(format!("{DEFAULT_NAME}.{}", format.extension()))
        .add_filter(format.extension().to_uppercase(), &[format.extension()])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|_| "保存位置无效。".to_owned())?;
    write_audio(&path, audio, format)?;
    let name = file_name(&path);
    *last.0.lock().map_err(|_| "导出状态不可用。".to_owned())? = Some(path);
    Ok(Some(name))
}

/// Saves the subtitles next to the audio just exported, with the same name. Returns the file name.
#[tauri::command]
pub fn dubbing_export_subtitles(last: State<'_, LastExport>, text: String) -> Result<String, String> {
    if text.is_empty() || text.len() > MAX_SUBTITLE_BYTES {
        return Err("字幕内容无效。".into());
    }
    let audio = last
        .0
        .lock()
        .map_err(|_| "导出状态不可用。".to_owned())?
        .take()
        .ok_or("先导出音频，再保存字幕。")?;
    let path = audio.with_extension("srt");
    crate::system::write_whole(&path, text.as_bytes()).map_err(|error| {
        log::warn!("failed to write dubbing subtitles: {error}");
        "字幕没能保存，请再试一次。".to_owned()
    })?;
    Ok(file_name(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(data_bytes: usize) -> Vec<u8> {
        let mut audio = b"RIFF\0\0\0\0WAVE".to_vec();
        audio.resize(WAV_HEADER_BYTES + data_bytes, 0);
        audio
    }

    #[test]
    fn takes_only_the_two_formats() {
        assert_eq!(Format::parse("wav"), Some(Format::Wav));
        assert_eq!(Format::parse("m4a"), Some(Format::M4a));
        assert_eq!(Format::parse("mp3"), None);
        assert_eq!(Format::parse("../wav"), None);
    }

    #[test]
    fn accepts_a_wav_up_to_thirty_minutes() {
        assert!(check_wav(&wav(2)).is_ok());
        assert!(check_wav(&wav(MAX_AUDIO_BYTES - WAV_HEADER_BYTES)).is_ok());
        assert!(check_wav(&wav(MAX_AUDIO_BYTES - WAV_HEADER_BYTES + 1)).is_err());
        assert!(check_wav(&wav(0)).is_err());
        let mut not_wav = wav(2);
        not_wav[8..12].copy_from_slice(b"AVI ");
        assert!(check_wav(&not_wav).is_err());
    }

    #[test]
    fn converts_to_m4a_with_the_system_tool() {
        let dir = std::env::temp_dir().join(format!("ai-pet-dubbing-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // A real header: 24 kHz, 16-bit mono, a tenth of a second of silence.
        let samples = 2_400u32;
        let mut audio = Vec::new();
        audio.extend_from_slice(b"RIFF");
        audio.extend_from_slice(&(36 + samples * 2).to_le_bytes());
        audio.extend_from_slice(b"WAVEfmt ");
        audio.extend_from_slice(&16u32.to_le_bytes());
        audio.extend_from_slice(&1u16.to_le_bytes());
        audio.extend_from_slice(&1u16.to_le_bytes());
        audio.extend_from_slice(&24_000u32.to_le_bytes());
        audio.extend_from_slice(&48_000u32.to_le_bytes());
        audio.extend_from_slice(&2u16.to_le_bytes());
        audio.extend_from_slice(&16u16.to_le_bytes());
        audio.extend_from_slice(b"data");
        audio.extend_from_slice(&(samples * 2).to_le_bytes());
        audio.resize(audio.len() + samples as usize * 2, 0);
        let target = dir.join("配音.m4a");
        write_audio(&target, &audio, Format::M4a).unwrap();
        assert!(std::fs::metadata(&target).unwrap().len() > 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

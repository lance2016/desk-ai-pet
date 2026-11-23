//! Puts our hooks into Claude Code's user settings (`~/.claude/settings.json`)
//! and takes them out again, leaving everything else in the file as it was.
//!
//! Ours are the hooks whose command carries `--agent-hook claude`; they run
//! in the background (`async`), so Claude Code never waits for the pet. The
//! file is copied to `settings.json.ai-pet-backup` before the first change;
//! later changes keep that copy, so it stays the user's own file.

use std::{
    fs,
    io::{ErrorKind, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{Map, Value, json};
use tauri::AppHandle;

use crate::agent_hooks::{self, EVENTS, HOOK_FLAG};

const AGENT: &str = "claude";
const BACKUP_SUFFIX: &str = ".ai-pet-backup";
const TEMP_NAME: &str = ".settings.json.ai-pet-tmp";
/// Seconds Claude Code gives a hook; ours take a few milliseconds.
const HOOK_TIMEOUT_SECS: u64 = 5;
/// The notifications that mean Claude is stuck until the user answers; the rest are not forwarded.
const NOTIFICATION_MATCHER: &str = "permission_prompt|elicitation_dialog";

const NO_CLAUDE: &str = "没找到 Claude Code 的设置文件夹（~/.claude），先装好 Claude Code 并打开一次。";
const BAD_FILE: &str = "Claude Code 的设置文件（~/.claude/settings.json）不是有效的 JSON，先修好它再试。";
const BAD_HOOKS: &str = "Claude Code 设置里的 hooks 格式和预想的不一样，没有改动。";
const READ_FAILED: &str = "读不了 Claude Code 的设置文件。";
const WRITE_FAILED: &str = "写不进 Claude Code 的设置文件，没有改动。";
const NO_APP_PATH: &str = "找不到 AI Pet 自己的位置。";
const NOT_MOVED: &str = "先把 AI Pet 拖进「应用程序」文件夹，从那里打开再连接。";
const NOT_INSTALLED: &str = "只能在装好的 AI Pet 里连接，开发版不行。";
/// A settings file made from scratch: only the user may read it.
const PRIVATE_FILE_MODE: u32 = 0o600;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeHooksState {
    connected: bool,
    current: bool,
    last_report_at: Option<u64>,
}

fn claude_folder() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?).join(".claude"))
}

/// The hook command for this copy of the app. Quiet and successful when the app has since been removed.
fn our_command(exe: &Path) -> String {
    let quoted = format!("'{}'", exe.to_string_lossy().replace('\'', r"'\''"));
    format!("[ -x {quoted} ] && {quoted} {HOOK_FLAG} {AGENT} || true")
}

fn is_ours(hook: &Value) -> bool {
    hook.get("command").and_then(Value::as_str).is_some_and(|command| command.contains(&format!("{HOOK_FLAG} {AGENT}")))
}

fn hooks_of(settings: &Value) -> Result<Option<&Map<String, Value>>, &'static str> {
    match settings.as_object().ok_or(BAD_FILE)?.get("hooks") {
        None => Ok(None),
        Some(hooks) => hooks.as_object().map(Some).ok_or(BAD_HOOKS),
    }
}

/// Whether our hooks are there, and whether each event has exactly the one for this copy of the app.
fn state_of(settings: &Value, command: &str) -> Result<(bool, bool), &'static str> {
    let Some(hooks) = hooks_of(settings)? else { return Ok((false, false)) };
    let ours = |event: &str| -> Vec<&Value> {
        let groups = hooks.get(event).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
        groups.iter().filter_map(|group| group.get("hooks").and_then(Value::as_array)).flatten().filter(|hook| is_ours(hook)).collect()
    };
    let connected = EVENTS.iter().any(|event| !ours(event).is_empty());
    let current = EVENTS.iter().all(|event| matches!(ours(event).as_slice(), [hook] if hook.get("command").and_then(Value::as_str) == Some(command)));
    Ok((connected, current))
}

/// The settings without our hooks; groups and events left empty by that go too.
fn without_ours(settings: Value) -> Result<Value, &'static str> {
    let Some(hooks) = hooks_of(&settings)? else { return Ok(settings) };
    let had_hooks = !hooks.is_empty();
    let mut cleaned = Map::new();
    for (event, groups) in hooks {
        let Some(groups) = groups.as_array() else { return Err(BAD_HOOKS) };
        let kept: Vec<Value> = groups.iter().filter_map(|group| {
            let Some(list) = group.get("hooks").and_then(Value::as_array) else { return Some(group.clone()) };
            let others: Vec<Value> = list.iter().filter(|hook| !is_ours(hook)).cloned().collect();
            match (others.len() == list.len(), others.is_empty()) {
                (true, _) => Some(group.clone()),
                (false, true) => None,
                (false, false) => {
                    let mut group = group.clone();
                    group["hooks"] = Value::Array(others);
                    Some(group)
                }
            }
        }).collect();
        if kept.is_empty() && !groups.is_empty() {
            continue;
        }
        cleaned.insert(event.clone(), Value::Array(kept));
    }
    let mut settings = settings;
    if cleaned.is_empty() && had_hooks {
        settings.as_object_mut().ok_or(BAD_FILE)?.remove("hooks");
    } else {
        settings["hooks"] = Value::Object(cleaned);
    }
    Ok(settings)
}

/// The settings with one hook of ours on each event, replacing any older ones.
fn with_ours(settings: Value, command: &str) -> Result<Value, &'static str> {
    let mut settings = without_ours(settings)?;
    let object = settings.as_object_mut().ok_or(BAD_FILE)?;
    let hooks = object.entry("hooks").or_insert_with(|| Value::Object(Map::new())).as_object_mut().ok_or(BAD_HOOKS)?;
    for event in EVENTS {
        let hook = json!({ "type": "command", "command": command, "async": true, "timeout": HOOK_TIMEOUT_SECS });
        let group = if event == "Notification" { json!({ "matcher": NOTIFICATION_MATCHER, "hooks": [hook] }) } else { json!({ "hooks": [hook] }) };
        hooks.entry(event).or_insert_with(|| Value::Array(Vec::new())).as_array_mut().ok_or(BAD_HOOKS)?.push(group);
    }
    Ok(settings)
}

fn settings_file() -> Result<PathBuf, &'static str> {
    let folder = claude_folder().ok_or(NO_CLAUDE)?;
    if !folder.is_dir() {
        return Err(NO_CLAUDE);
    }
    Ok(folder.join("settings.json"))
}

/// The settings, or an empty object when the file is not there yet.
fn read(path: &Path) -> Result<Value, &'static str> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map_err(|_| BAD_FILE),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(error) => {
            log::warn!("Could not read Claude Code's settings: {}", error.kind());
            Err(READ_FAILED)
        }
    }
}

/// Backs the file up unless a backup is already there, then replaces it in one step. A linked settings file is written where it points.
fn write(path: &Path, settings: &Value) -> Result<(), &'static str> {
    let failed = |error: std::io::Error| {
        log::warn!("Could not write Claude Code's settings: {}", error.kind());
        WRITE_FAILED
    };
    // The file may hold API keys: the new one keeps the old one's permissions, or only the user may read it.
    let (target, mode) = if path.exists() {
        let target = fs::canonicalize(path).map_err(failed)?;
        let mut backup = target.clone().into_os_string();
        backup.push(BACKUP_SUFFIX);
        // Only the first time: a later copy would hold our hooks and replace the user's original.
        if !Path::new(&backup).exists() {
            fs::copy(&target, &backup).map_err(failed)?;
        }
        let mode = fs::metadata(&target).map_err(failed)?.permissions().mode();
        (target, mode)
    } else {
        (path.to_path_buf(), PRIVATE_FILE_MODE)
    };
    let temp = target.with_file_name(TEMP_NAME);
    let text = serde_json::to_string_pretty(settings).map_err(|_| WRITE_FAILED)? + "\n";
    let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(PRIVATE_FILE_MODE).open(&temp).map_err(failed)?;
    file.write_all(text.as_bytes()).map_err(failed)?;
    file.set_permissions(fs::Permissions::from_mode(mode)).map_err(failed)?;
    drop(file);
    fs::rename(&temp, &target).map_err(failed)
}

/// Only an installed app can be connected: a dev build's path goes away with the build, a translocated one with the next launch.
fn installed(exe: &Path) -> Result<&Path, &'static str> {
    let path = exe.to_string_lossy();
    if path.contains("/AppTranslocation/") {
        return Err(NOT_MOVED);
    }
    if !path.ends_with(".app/Contents/MacOS/ai-pet") {
        return Err(NOT_INSTALLED);
    }
    Ok(exe)
}

fn this_command() -> Result<String, &'static str> {
    let exe = std::env::current_exe().map_err(|_| NO_APP_PATH)?;
    Ok(our_command(installed(&exe)?))
}

#[tauri::command]
pub fn claude_hooks_state(app: AppHandle) -> Result<ClaudeHooksState, String> {
    let settings = match settings_file() {
        Ok(path) => read(&path)?,
        Err(_) => Value::Object(Map::new()),
    };
    // A dev build only compares; it cannot connect.
    let exe = std::env::current_exe().map_err(|_| NO_APP_PATH)?;
    let (connected, current) = state_of(&settings, &our_command(&exe))?;
    Ok(ClaudeHooksState { connected, current, last_report_at: agent_hooks::last_report(&app) })
}

#[tauri::command]
pub fn claude_hooks_connect() -> Result<(), String> {
    let path = settings_file()?;
    let settings = with_ours(read(&path)?, &this_command()?)?;
    write(&path, &settings)?;
    log::info!("Added AI Pet's hooks to Claude Code's settings");
    Ok(())
}

#[tauri::command]
pub fn claude_hooks_disconnect() -> Result<(), String> {
    let path = settings_file()?;
    let before = read(&path)?;
    let after = without_ours(before.clone())?;
    if after != before {
        write(&path, &after)?;
        log::info!("Took AI Pet's hooks out of Claude Code's settings");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMMAND: &str = "[ -x '/Applications/AI Pet.app/Contents/MacOS/ai-pet' ] && '/Applications/AI Pet.app/Contents/MacOS/ai-pet' --agent-hook claude || true";

    fn others() -> Value {
        json!({
            "model": "opus",
            "hooks": {
                "Stop": [{ "hooks": [{ "type": "command", "command": "other-stop" }] }],
                "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "other-pre" }] }]
            },
            "permissions": { "allow": [] }
        })
    }

    #[test]
    fn quotes_the_app_path_for_the_shell() {
        assert_eq!(our_command(Path::new("/Applications/AI Pet.app/Contents/MacOS/ai-pet")), COMMAND);
        assert!(our_command(Path::new("/tmp/it's/ai-pet")).contains(r"'/tmp/it'\''s/ai-pet'"));
    }

    #[test]
    fn adds_one_hook_per_event_next_to_the_users_own() {
        let settings = with_ours(others(), COMMAND).unwrap();
        assert_eq!(settings["model"], "opus");
        assert_eq!(settings["hooks"]["Stop"][0]["hooks"][0]["command"], "other-stop");
        assert_eq!(settings["hooks"]["Stop"][1]["hooks"][0]["command"], COMMAND);
        assert_eq!(settings["hooks"]["Stop"][1]["hooks"][0]["async"], true);
        assert_eq!(settings["hooks"]["Notification"][0]["matcher"], NOTIFICATION_MATCHER);
        assert!(EVENTS.iter().all(|event| settings["hooks"][*event].as_array().is_some()));
        assert_eq!(state_of(&settings, COMMAND).unwrap(), (true, true));
    }

    #[test]
    fn keeps_the_order_of_the_users_keys() {
        let settings = with_ours(others(), COMMAND).unwrap();
        let keys: Vec<&String> = settings.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["model", "hooks", "permissions"]);
    }

    #[test]
    fn connecting_twice_or_from_a_moved_app_leaves_one_hook_each() {
        let moved = with_ours(others(), "[ -x '/old/ai-pet' ] && '/old/ai-pet' --agent-hook claude || true").unwrap();
        assert_eq!(state_of(&moved, COMMAND).unwrap(), (true, false));
        let settings = with_ours(with_ours(moved, COMMAND).unwrap(), COMMAND).unwrap();
        assert_eq!(settings["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(state_of(&settings, COMMAND).unwrap(), (true, true));
    }

    #[test]
    fn disconnecting_restores_the_users_settings() {
        assert_eq!(without_ours(with_ours(others(), COMMAND).unwrap()).unwrap(), others());
        assert_eq!(without_ours(with_ours(json!({}), COMMAND).unwrap()).unwrap(), json!({}));
        assert_eq!(state_of(&others(), COMMAND).unwrap(), (false, false));
    }

    #[test]
    fn keeps_a_users_hook_that_shares_a_group_with_ours() {
        let shared = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "mine" }, { "type": "command", "command": COMMAND }] }] } });
        assert_eq!(without_ours(shared).unwrap(), json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "mine" }] }] } }));
    }

    #[test]
    fn refuses_settings_it_does_not_understand() {
        assert_eq!(with_ours(json!([1, 2]), COMMAND).unwrap_err(), BAD_FILE);
        assert_eq!(with_ours(json!({ "hooks": "x" }), COMMAND).unwrap_err(), BAD_HOOKS);
        assert_eq!(with_ours(json!({ "hooks": { "Stop": {} } }), COMMAND).unwrap_err(), BAD_HOOKS);
    }

    #[test]
    fn writes_through_a_link_and_keeps_a_backup() {
        let folder = tempfile::tempdir().unwrap();
        let real = folder.path().join("real.json");
        fs::write(&real, "{\"model\":\"opus\"}").unwrap();
        let link = folder.path().join("settings.json");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write(&link, &json!({ "model": "sonnet" })).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(read(&link).unwrap(), json!({ "model": "sonnet" }));
        assert_eq!(fs::read_to_string(folder.path().join("real.json.ai-pet-backup")).unwrap(), "{\"model\":\"opus\"}");
        write(&link, &json!({ "model": "haiku" })).unwrap();
        assert_eq!(fs::read_to_string(folder.path().join("real.json.ai-pet-backup")).unwrap(), "{\"model\":\"opus\"}");
    }

    #[test]
    fn keeps_the_files_permissions_and_makes_a_new_one_private() {
        let folder = tempfile::tempdir().unwrap();
        let kept = folder.path().join("settings.json");
        fs::write(&kept, "{}").unwrap();
        fs::set_permissions(&kept, fs::Permissions::from_mode(0o600)).unwrap();
        write(&kept, &json!({ "model": "sonnet" })).unwrap();
        assert_eq!(fs::metadata(&kept).unwrap().permissions().mode() & 0o777, 0o600);
        let fresh = folder.path().join("new").join("settings.json");
        fs::create_dir(fresh.parent().unwrap()).unwrap();
        write(&fresh, &json!({})).unwrap();
        assert_eq!(fs::metadata(&fresh).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn connects_only_an_installed_app() {
        assert!(installed(Path::new("/Applications/AI Pet.app/Contents/MacOS/ai-pet")).is_ok());
        assert_eq!(installed(Path::new("/private/var/folders/x/T/AppTranslocation/1/d/AI Pet.app/Contents/MacOS/ai-pet")).unwrap_err(), NOT_MOVED);
        assert_eq!(installed(Path::new("/Users/me/ai-pet/src-tauri/target/debug/ai-pet")).unwrap_err(), NOT_INSTALLED);
    }
}

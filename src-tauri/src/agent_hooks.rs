//! Claude Code's status, from its hooks.
//!
//! Claude Code runs this same binary as a hook (`ai-pet --agent-hook claude`).
//! Run that way it never starts the app: it reads the event from stdin, keeps
//! only what the pet shows, writes one line to a Unix socket in the app's data
//! folder and exits 0 without printing anything, so it can neither block nor
//! steer Claude Code. The running app listens on that socket and passes each
//! event to the pet window.
//!
//! Claude Code reports nothing when the user presses Esc. For that the pet
//! window asks `agent_interrupted`, which reads the end of the session's
//! transcript for Claude Code's own interruption marker. Only that answer
//! leaves this module; transcript text is never logged, kept or sent.

use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    os::unix::{
        fs::{DirBuilderExt, PermissionsExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    sync::{
        Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

/// The argument Claude Code's hook command passes. `claude_settings.rs` writes it.
pub(crate) const HOOK_FLAG: &str = "--agent-hook";
/// Tells the pet window about an event. Must match `src/platform/agents.ts`.
const EVENT: &str = "pet://agent";
const MAIN_WINDOW: &str = "main";
/// Must match `identifier` in tauri.conf.json: the socket lives in the app's data folder.
const IDENTIFIER: &str = "com.aipet.desktop";
/// Only the user can enter it, so whoever reaches the socket is the user.
const SOCKET_FOLDER: &str = "agent";
const SOCKET_NAME: &str = "hooks.sock";
/// The events forwarded. Must match `AGENT_EVENTS` in src/types.ts and the hooks in claude_settings.rs.
pub(crate) const EVENTS: [&str; 7] = ["UserPromptSubmit", "PermissionRequest", "PostToolUse", "Notification", "Stop", "StopFailure", "SessionEnd"];
/// A tool's output comes along on stdin (PostToolUse); anything bigger is not read.
const MAX_HOOK_INPUT: u64 = 32 * 1024 * 1024;
/// One forwarded line, far more than the fields kept need.
const MAX_LINE: u64 = 4096;
const SOCKET_TIMEOUT: Duration = Duration::from_secs(1);
/// What Claude Code writes when the user stops a turn or refuses a tool with Esc.
const INTERRUPT_MARK: &str = "[Request interrupted by user";
/// The end of the transcript looked at; the lines after an interruption are short.
const TAIL_BYTES: u64 = 64 * 1024;
const MAX_ID_CHARS: usize = 56;
/// A folder or tool name is cut to this before it is forwarded.
const MAX_FORWARDED_CHARS: usize = 64;
const MAX_NAME_CHARS: usize = 255;
const MAX_KIND_CHARS: usize = 64;
/// Transcripts remembered for the interruption check; sessions that ended without saying so drop off.
const MAX_SESSIONS: usize = 64;

/// What Claude Code sends a hook on stdin; everything else in it is skipped.
#[derive(Deserialize)]
struct HookInput {
    hook_event_name: String,
    session_id: String,
    #[serde(default)]
    cwd: String,
    #[serde(default)]
    transcript_path: Option<String>,
    #[serde(default)]
    tool_name: Option<String>,
    #[serde(default)]
    notification_type: Option<String>,
    #[serde(default)]
    error: Option<Value>,
    /// Set when the event comes from a subagent of the session.
    #[serde(default)]
    agent_id: Option<String>,
}

/// One line on the socket.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Forwarded {
    event: String,
    session: String,
    project: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notification: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    subagent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    transcript: Option<String>,
}

/// What the pet window gets: `Forwarded` without the transcript path.
#[derive(Serialize, Clone)]
struct Report {
    event: String,
    session: String,
    project: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notification: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    subagent: bool,
}

#[derive(Default)]
pub struct AgentHooks {
    /// Each session's transcript, from its hook events.
    transcripts: Mutex<HashMap<String, PathBuf>>,
    /// When a hook last reported, in milliseconds since the epoch; 0 for never.
    last_report: AtomicU64,
}

fn is_false(value: &bool) -> bool {
    !value
}

/// `text` cut to `max` characters, so a long name shows shortened rather than not at all.
fn cut(text: String, max: usize) -> String {
    if text.chars().count() <= max { text } else { text.chars().take(max).collect() }
}

fn socket_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Application Support").join(IDENTIFIER).join(SOCKET_FOLDER).join(SOCKET_NAME))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// Runs in place of the app when Claude Code calls it as a hook. Returns true when it did.
pub fn forward_if_hook() -> bool {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(HOOK_FLAG) {
        return false;
    }
    // Only Claude Code for now; another agent would bring its own name.
    if args.next().as_deref() == Some("claude") {
        let mut input = Vec::new();
        if std::io::stdin().take(MAX_HOOK_INPUT).read_to_end(&mut input).is_ok() {
            if let Some(line) = forwarded_line(&input) {
                send(&line);
            }
        }
    }
    true
}

/// The line to forward, or None for an event the pet does not show or input it cannot read.
fn forwarded_line(input: &[u8]) -> Option<String> {
    let hook: HookInput = serde_json::from_slice(input).ok()?;
    if !EVENTS.contains(&hook.hook_event_name.as_str()) {
        return None;
    }
    let project = Path::new(&hook.cwd).file_name().map(|name| cut(name.to_string_lossy().into_owned(), MAX_FORWARDED_CHARS)).unwrap_or_default();
    let error = hook.error.and_then(|error| match error {
        Value::String(kind) => Some(kind),
        other => other.get("type").and_then(Value::as_str).map(str::to_owned),
    });
    let forwarded = Forwarded {
        event: hook.hook_event_name,
        session: hook.session_id,
        project,
        tool: hook.tool_name.map(|tool| cut(tool, MAX_FORWARDED_CHARS)),
        notification: hook.notification_type,
        error,
        subagent: hook.agent_id.is_some(),
        transcript: hook.transcript_path,
    };
    serde_json::to_string(&forwarded).ok()
}

/// The app may not be running; then there is nobody to tell.
fn send(line: &str) {
    let Some(path) = socket_path() else { return };
    let Ok(mut stream) = UnixStream::connect(path) else { return };
    let _ = stream.set_write_timeout(Some(SOCKET_TIMEOUT));
    let _ = stream.write_all(line.as_bytes());
}

/// Starts listening for hook events. Another running copy of the app (a dev build) keeps the socket.
pub fn listen(app: &AppHandle) {
    let Some(path) = socket_path() else {
        log::warn!("No home folder; Claude Code's status will not show");
        return;
    };
    if UnixStream::connect(&path).is_ok() {
        log::warn!("Another copy of AI Pet is taking Claude Code's status");
        return;
    }
    let listener = match bind(&path) {
        Ok(listener) => listener,
        Err(error) => {
            log::error!("Could not listen for Claude Code's hooks: {error}");
            return;
        }
    };
    let app = app.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if let Some(forwarded) = read_line(stream) {
                take(&app, forwarded);
            }
        }
    });
}

fn bind(path: &Path) -> std::io::Result<UnixListener> {
    if let Some(folder) = path.parent() {
        fs::DirBuilder::new().recursive(true).mode(0o700).create(folder)?;
        fs::set_permissions(folder, fs::Permissions::from_mode(0o700))?;
    }
    // Left over from a run that did not shut down; nobody answered on it above.
    match fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    UnixListener::bind(path)
}

fn read_line(stream: UnixStream) -> Option<Forwarded> {
    stream.set_read_timeout(Some(SOCKET_TIMEOUT)).ok()?;
    let mut line = String::new();
    BufReader::new(stream.take(MAX_LINE)).read_line(&mut line).ok()?;
    let forwarded: Forwarded = serde_json::from_str(line.trim()).ok()?;
    valid(&forwarded).then_some(forwarded)
}

fn valid(forwarded: &Forwarded) -> bool {
    let short = |text: &Option<String>, max: usize| text.as_ref().is_none_or(|text| !text.is_empty() && text.chars().count() <= max);
    EVENTS.contains(&forwarded.event.as_str())
        && !forwarded.session.is_empty()
        && forwarded.session.len() <= MAX_ID_CHARS
        && forwarded.session.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && forwarded.project.chars().count() <= MAX_NAME_CHARS
        && short(&forwarded.tool, MAX_NAME_CHARS)
        && short(&forwarded.notification, MAX_KIND_CHARS)
        && short(&forwarded.error, MAX_KIND_CHARS)
}

fn take(app: &AppHandle, forwarded: Forwarded) {
    let hooks = app.state::<AgentHooks>();
    hooks.last_report.store(now_ms(), Ordering::Relaxed);
    {
        let mut transcripts = hooks.transcripts.lock().unwrap_or_else(PoisonError::into_inner);
        if forwarded.event == "SessionEnd" {
            transcripts.remove(&forwarded.session);
        } else if let Some(path) = forwarded.transcript.as_deref().and_then(transcript_path) {
            if transcripts.len() >= MAX_SESSIONS && !transcripts.contains_key(&forwarded.session) {
                transcripts.clear();
            }
            transcripts.insert(forwarded.session.clone(), path);
        }
    }
    let report = Report {
        event: forwarded.event,
        session: forwarded.session,
        project: forwarded.project,
        tool: forwarded.tool,
        notification: forwarded.notification,
        error: forwarded.error,
        subagent: forwarded.subagent,
    };
    if let Err(error) = app.emit_to(MAIN_WINDOW, EVENT, report) {
        log::warn!("Could not pass Claude Code's status to the pet: {error}");
    }
}

/// Only a transcript in Claude Code's own folder is ever opened.
fn transcript_path(raw: &str) -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    let path = Path::new(raw);
    let inside = path.is_absolute()
        && path.extension().is_some_and(|extension| extension == "jsonl")
        && path.components().all(|part| matches!(part, std::path::Component::RootDir | std::path::Component::Normal(_)))
        && path.starts_with(home.join(".claude/projects"));
    inside.then(|| path.to_path_buf())
}

/// When a hook last reported, in milliseconds; None if none since the app started.
pub(crate) fn last_report(app: &AppHandle) -> Option<u64> {
    match app.state::<AgentHooks>().last_report.load(Ordering::Relaxed) {
        0 => None,
        at => Some(at),
    }
}

/// Whether the session's transcript shows the user interrupted it after `since` (milliseconds).
#[tauri::command]
pub fn agent_interrupted(app: AppHandle, session: String, since: f64) -> bool {
    let path = app.state::<AgentHooks>().transcripts.lock().unwrap_or_else(PoisonError::into_inner).get(&session).cloned();
    let Some(path) = path else { return false };
    match tail(&path) {
        Ok(text) => interrupted_after(&text, since),
        Err(error) => {
            log::warn!("Could not read the end of a Claude Code transcript: {}", error.kind());
            false
        }
    }
}

fn tail(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(TAIL_BYTES)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// A user line that is Claude Code's own interruption mark, written after `since`. The first line may be cut and is skipped by the parse.
fn interrupted_after(tail: &str, since: f64) -> bool {
    tail.lines().filter(|line| line.contains(INTERRUPT_MARK)).filter_map(|line| serde_json::from_str::<Value>(line).ok()).any(|entry| {
        let written = entry.get("timestamp").and_then(Value::as_str).and_then(epoch_ms);
        entry.get("type").and_then(Value::as_str) == Some("user") && is_mark(entry.pointer("/message/content")) && written.is_some_and(|at| at > since)
    })
}

/// The message is the mark itself: a text that starts with it, not a tool's output that happens to contain it.
fn is_mark(content: Option<&Value>) -> bool {
    match content {
        Some(Value::String(text)) => text.starts_with(INTERRUPT_MARK),
        Some(Value::Array(blocks)) => blocks.iter().any(|block| {
            block.get("type").and_then(Value::as_str) == Some("text") && block.get("text").and_then(Value::as_str).is_some_and(|text| text.starts_with(INTERRUPT_MARK))
        }),
        _ => false,
    }
}

/// "2026-11-21T01:23:24.123Z" in milliseconds since the epoch. Claude Code writes UTC with a Z.
fn epoch_ms(stamp: &str) -> Option<f64> {
    let (date, time) = stamp.strip_suffix('Z')?.split_once('T')?;
    let mut date = date.splitn(3, '-').map(str::parse::<i64>);
    let (year, month, day) = (date.next()?.ok()?, date.next()?.ok()?, date.next()?.ok()?);
    let mut time = time.splitn(3, ':');
    let (hour, minute) = (time.next()?.parse::<i64>().ok()?, time.next()?.parse::<i64>().ok()?);
    let second = time.next()?.parse::<f64>().ok()?;
    // Days from the civil date, after Howard Hinnant's days_from_civil.
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
    let days = era * 146_097 + of_cycle - 719_468;
    Some(((days * 86_400 + hour * 3600 + minute * 60) as f64 + second) * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOOK: &str = r#"{"session_id":"51595e2a-65fa-42e0-96d7-8ba91d2c7fa1","transcript_path":"/Users/me/.claude/projects/p/51595e2a.jsonl","cwd":"/Users/me/work/ai-pet","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf dist"},"prompt":"secret"}"#;

    #[test]
    fn forwards_only_what_the_pet_shows() {
        let line = forwarded_line(HOOK.as_bytes()).unwrap();
        assert!(!line.contains("rm -rf") && !line.contains("secret"));
        let forwarded: Forwarded = serde_json::from_str(&line).unwrap();
        assert_eq!(forwarded.event, "PermissionRequest");
        assert_eq!(forwarded.project, "ai-pet");
        assert_eq!(forwarded.tool.as_deref(), Some("Bash"));
        assert!(!forwarded.subagent && !line.contains("subagent"));
        assert!(valid(&forwarded));
    }

    #[test]
    fn marks_a_subagents_event_and_cuts_long_names() {
        let hook = HOOK.replace("/ai-pet\"", &format!("/{}\",\"agent_id\":\"a1\"", "长".repeat(100)));
        let forwarded: Forwarded = serde_json::from_str(&forwarded_line(hook.as_bytes()).unwrap()).unwrap();
        assert!(forwarded.subagent);
        assert_eq!(forwarded.project.chars().count(), MAX_FORWARDED_CHARS);
    }

    #[test]
    fn skips_events_it_does_not_show_and_input_it_cannot_read() {
        assert!(forwarded_line(HOOK.replace("PermissionRequest", "PreToolUse").as_bytes()).is_none());
        assert!(forwarded_line(b"not json").is_none());
    }

    #[test]
    fn takes_a_failure_kind_given_as_text_or_as_an_object() {
        let text = HOOK.replace("PermissionRequest", "StopFailure").replace(r#""tool_name":"Bash""#, r#""error":"rate_limit""#);
        assert_eq!(serde_json::from_str::<Forwarded>(&forwarded_line(text.as_bytes()).unwrap()).unwrap().error.as_deref(), Some("rate_limit"));
        let object = HOOK.replace("PermissionRequest", "StopFailure").replace(r#""tool_name":"Bash""#, r#""error":{"type":"server_error"}"#);
        assert_eq!(serde_json::from_str::<Forwarded>(&forwarded_line(object.as_bytes()).unwrap()).unwrap().error.as_deref(), Some("server_error"));
    }

    #[test]
    fn refuses_odd_lines_on_the_socket() {
        let good = Forwarded { event: "Stop".into(), session: "abc-123".into(), project: "p".into(), tool: None, notification: None, error: None, subagent: false, transcript: None };
        assert!(valid(&good));
        assert!(!valid(&Forwarded { event: "PreToolUse".into(), ..clone(&good) }));
        assert!(!valid(&Forwarded { session: "../x".into(), ..clone(&good) }));
        assert!(!valid(&Forwarded { session: "a".repeat(MAX_ID_CHARS + 1), ..clone(&good) }));
        assert!(!valid(&Forwarded { tool: Some(String::new()), ..clone(&good) }));
    }

    fn clone(forwarded: &Forwarded) -> Forwarded {
        serde_json::from_str(&serde_json::to_string(forwarded).unwrap()).unwrap()
    }

    #[test]
    fn opens_only_transcripts_in_claude_codes_folder() {
        let home = std::env::var("HOME").unwrap();
        assert!(transcript_path(&format!("{home}/.claude/projects/p/s.jsonl")).is_some());
        assert!(transcript_path(&format!("{home}/.claude/projects/../../.ssh/id.jsonl")).is_none());
        assert!(transcript_path(&format!("{home}/.claude/projects/p/s.json")).is_none());
        assert!(transcript_path("/etc/passwd").is_none());
        assert!(transcript_path(".claude/projects/p/s.jsonl").is_none());
    }

    #[test]
    fn reads_utc_stamps() {
        assert_eq!(epoch_ms("1970-01-01T00:00:00.000Z"), Some(0.0));
        assert_eq!(epoch_ms("2026-11-21T01:23:24.500Z"), Some(1_795_224_204_500.0));
        assert_eq!(epoch_ms("2026-11-21 01:23:24"), None);
    }

    // Lines as Claude Code 2.1.330 wrote them after Esc on a permission prompt.
    const TAIL: &str = concat!(
        "{\"type\":\"assistant\",\"timestamp\":\"2026-11-21T01:22:52.000Z\",\"message\":{\"content\":[]}}\n",
        "{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"[Request interrupted by user for tool use]\"}]}}\n",
        "{\"type\":\"last-prompt\"}\n",
    );

    #[test]
    fn finds_an_interruption_written_after_the_last_event() {
        let before = epoch_ms("2026-11-21T01:22:52.000Z").unwrap();
        let after = epoch_ms("2026-11-21T01:23:30.000Z").unwrap();
        assert!(interrupted_after(TAIL, before));
        assert!(!interrupted_after(TAIL, after));
        assert!(!interrupted_after("{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":\"x\"}\n", before));
        assert!(interrupted_after("{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":\"[Request interrupted by user]\"}}\n", before));
        // A cut first line, the words in Claude's own reply, or a tool's output carrying them is not taken for the mark.
        assert!(!interrupted_after("t\":\"[Request interrupted by user\"}\n", before));
        assert!(!interrupted_after("{\"type\":\"assistant\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"[Request interrupted by user\"}]}}\n", before));
        assert!(!interrupted_after("{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":[{\"type\":\"tool_result\",\"content\":\"[Request interrupted by user]\"}]}}\n", before));
        assert!(!interrupted_after("{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":\"see [Request interrupted by user]\"}}\n", before));
    }
}

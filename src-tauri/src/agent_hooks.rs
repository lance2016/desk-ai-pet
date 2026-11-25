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
//! window asks `agent_turn_over`, which reads the end of the session's
//! transcript for Claude Code's own interruption marker, and for the line it
//! writes when a turn ends (in case the Stop event went missing). Only that
//! answer leaves this module; transcript text is never logged, kept or sent.
//!
//! The hook also passes on which app Claude Code runs in (the terminal, an
//! editor) and the terminal device it is attached to, so a click on the
//! session can bring that app forward (`agent_reveal`); in Ghostty, which
//! names each terminal's device in its scripting dictionary, the very window,
//! tab and split. Both stay here; the pet window only learns there is somewhere to go.
//!
//! What the pet shows about a session's work is one short line each: the first
//! line of what the user asked, the file or the described step a tool is on,
//! the branch, and the start of Claude's last reply. Commands, code and tool
//! output are never forwarded. A session's transcript path and app are kept in
//! a file beside the socket, so a restarted pet can still check on it.

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
pub(crate) const IDENTIFIER: &str = "com.aipet.desktop";
/// Only the user can enter it, so whoever reaches the socket is the user.
const SOCKET_FOLDER: &str = "agent";
const SOCKET_NAME: &str = "hooks.sock";
/// The events forwarded. Must match `AGENT_EVENTS` in src/types.ts and the hooks in claude_settings.rs.
pub(crate) const EVENTS: [&str; 9] = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "Notification", "Stop", "StopFailure", "SessionEnd"];
/// A tool's output comes along on stdin (PostToolUse); anything bigger is not read.
const MAX_HOOK_INPUT: u64 = 32 * 1024 * 1024;
/// One forwarded line, far more than the fields kept need.
const MAX_LINE: u64 = 8192;
/// The sessions' transcripts and apps, kept beside the socket for the next run.
const SESSIONS_NAME: &str = "sessions.json";
const PRIVATE_FILE_MODE: u32 = 0o600;
const SOCKET_TIMEOUT: Duration = Duration::from_secs(1);
/// What Claude Code writes when the user stops a turn or refuses a tool with Esc.
const INTERRUPT_MARK: &str = "[Request interrupted by user";
/// The `subtype` of the system line Claude Code writes once a turn has ended (2.1.330, not documented).
const TURN_END_MARK: &str = "turn_duration";
/// How the prompt starts when Claude Code wakes a session because background work ended (2.1.331, not documented).
const TASK_NOTIFICATION: &str = "<task-notification>";
/// The `type` of the line Claude Code writes with its own name for the session, and the field holding it (2.1.330, not documented).
const TITLE_MARK: &str = "ai-title";
const TITLE_FIELD: &str = "aiTitle";
/// Set by Claude Code for its hooks: the folder the session was started in, which the shell's `cd` does not move.
const PROJECT_DIR_VAR: &str = "CLAUDE_PROJECT_DIR";
/// Set by macOS for programs started from an app: the app Claude Code runs in.
const HOST_APP_VAR: &str = "__CFBundleIdentifier";
const MAX_APP_ID_CHARS: usize = 155;
/// Ghostty can focus one of its terminals by its device; other apps are only brought forward.
const GHOSTTY: &str = "com.mitchellh.ghostty";
/// The hook runs a shell that runs it, under Claude Code: that many processes up at most to find the terminal.
const TTY_ANCESTORS: usize = 4;
/// Focuses the Ghostty terminal on the device given as the only argument: its window, its tab and its split.
/// Never compiled from a string with the device in it. Ghostty lists its windows front to back and `repeat with`
/// hands out references by position, so once a window is focused the same reference means another window:
/// the terminal, its tab and its window are found by their stable ids first, and only those ids are used after.
/// Ghostty's `focus` (1.4) does not unzoom: when another split of the tab is zoomed the focus stays put, so that
/// split is unzoomed first, as Ghostty does itself when moving between splits (`split-preserve-zoom` left at its
/// default). If the focus still does not move, the zoom is put back. `focus` returns before it is done, hence the pauses.
const GHOSTTY_FOCUS: &str = r#"on run argv
  set wanted to item 1 of argv
  tell application id "com.mitchellh.ghostty"
    set found to missing value
    repeat with w in windows
      repeat with tb in tabs of w
        repeat with candidate in terminals of tb
          if found is missing value and tty of candidate is wanted then set found to {id of w, id of tb, id of candidate}
        end repeat
      end repeat
    end repeat
    if found is missing value then return "missing"
    set {windowId, tabId, targetId} to found
    set target to terminal id targetId
    set place to tab id tabId of window id windowId
    focus target
    delay 0.3
    if id of focused terminal of place is not targetId then
      set shown to terminal id (id of focused terminal of place)
      perform action "toggle_split_zoom" on shown
      delay 0.3
      focus target
      delay 0.3
      if id of focused terminal of place is not targetId then perform action "toggle_split_zoom" on shown
    end if
    activate
    return "focused"
  end tell
end run"#;
/// The end of the transcript looked at; the lines after an interruption are short.
const TAIL_BYTES: u64 = 64 * 1024;
const MAX_ID_CHARS: usize = 56;
/// A folder or tool name is cut to this before it is forwarded.
const MAX_FORWARDED_CHARS: usize = 64;
const MAX_NAME_CHARS: usize = 255;
const MAX_KIND_CHARS: usize = 64;
/// What the user asked, a session's title, and the start of Claude's last reply are cut to these.
const MAX_TASK_CHARS: usize = 80;
const MAX_SUMMARY_CHARS: usize = 160;
/// Tools whose input names the file they work on, and the ones that describe their step in words.
const FILE_TOOLS: [&str; 5] = ["Edit", "Write", "Read", "MultiEdit", "NotebookEdit"];
const DESCRIBED_TOOLS: [&str; 3] = ["Bash", "Agent", "Task"];
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
    tool_input: Option<Value>,
    /// What the user typed (UserPromptSubmit).
    #[serde(default)]
    prompt: Option<String>,
    /// The name the user gave the session, when they did.
    #[serde(default)]
    session_title: Option<String>,
    /// Claude's last reply (Stop).
    #[serde(default)]
    last_assistant_message: Option<String>,
    #[serde(default)]
    notification_type: Option<String>,
    #[serde(default)]
    error: Option<Value>,
    /// The shells and subagents Claude started in the background and still running (Stop). Only counted, never read.
    #[serde(default)]
    background_tasks: Option<Vec<Value>>,
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
    /// The bundle identifier of the app Claude Code runs in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    app: Option<String>,
    /// The terminal device Claude Code is attached to, such as "/dev/ttys012".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tty: Option<String>,
    #[serde(flatten)]
    work: Work,
}

/// What the pet shows about the session's work. Each a single short line.
#[derive(Serialize, Deserialize, Debug, PartialEq, Clone, Default)]
struct Work {
    /// When the hook ran, in milliseconds since the epoch: hooks run in the background and can arrive out of order.
    #[serde(default)]
    at: u64,
    /// The first line of what the user asked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    task: Option<String>,
    /// The name the user gave the session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    /// The file a tool works on, or its step as Claude described it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    /// The first line of Claude's last reply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    /// The turn ended with work it started still running in the background (Stop): Claude goes on once that is done.
    #[serde(default, skip_serializing_if = "is_false")]
    background: bool,
    /// Not the user asking: Claude Code woke the session because background work ended (UserPromptSubmit).
    #[serde(default, skip_serializing_if = "is_false")]
    woke: bool,
}

/// What the pet window gets: `Forwarded` without the transcript path and the app.
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
    /// The app the session runs in is known, so `agent_reveal` can bring it forward.
    #[serde(default, skip_serializing_if = "is_false")]
    revealable: bool,
    #[serde(flatten)]
    work: Work,
}

/// What is kept about a session for the pet window's later questions.
#[derive(Serialize, Deserialize, Default, Clone, PartialEq)]
struct Followed {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transcript: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tty: Option<String>,
    /// When the pet first heard of the session, in milliseconds since the epoch: the oldest goes first when full.
    #[serde(default)]
    since: u64,
}

#[derive(Default)]
pub struct AgentHooks {
    /// Each session's transcript and app, from its hook events.
    sessions: Mutex<HashMap<String, Followed>>,
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

fn sessions_path() -> Option<PathBuf> {
    Some(socket_path()?.with_file_name(SESSIONS_NAME))
}

/// The first line of `text` with something on it, without Markdown marks, cut to `max` characters.
/// Lines that open with a tag (pasted blocks, commands) are passed over.
fn one_line(text: &str, max: usize) -> Option<String> {
    let line = text.lines().map(|line| line.trim().trim_start_matches(['#', '>', '-', '*', ' ']).trim()).find(|line| !line.is_empty() && !line.starts_with('<'))?;
    let plain: String = line.replace("**", "").replace('`', "");
    let joined = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    (!joined.is_empty()).then(|| cut(joined, max))
}

/// What a tool is on: the name of its file, or its step in Claude's words. Never the command or the code.
fn tool_detail(tool: &str, input: &Value) -> Option<String> {
    let text = |key: &str| input.get(key).and_then(Value::as_str);
    if FILE_TOOLS.contains(&tool) {
        let path = text("file_path").or_else(|| text("notebook_path"))?;
        return Path::new(path).file_name().map(|name| cut(name.to_string_lossy().into_owned(), MAX_FORWARDED_CHARS));
    }
    if DESCRIBED_TOOLS.contains(&tool) {
        return one_line(text("description")?, MAX_FORWARDED_CHARS);
    }
    None
}

/// The branch checked out in `folder`, read from `.git/HEAD`; a short hash when no branch is. A worktree's `.git` is a file pointing at the real one.
fn git_branch(folder: &Path) -> Option<String> {
    let dot_git = folder.join(".git");
    let git_dir = if dot_git.is_file() {
        let pointer = fs::read_to_string(&dot_git).ok()?;
        folder.join(pointer.trim().strip_prefix("gitdir:")?.trim())
    } else {
        dot_git
    };
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();
    let name = head.strip_prefix("ref: refs/heads/").map_or_else(|| head.chars().take(7).collect(), str::to_owned);
    (!name.is_empty()).then(|| cut(name, MAX_FORWARDED_CHARS))
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
            let host = Host { project_dir: std::env::var(PROJECT_DIR_VAR).ok(), app: std::env::var(HOST_APP_VAR).ok(), tty: controlling_tty() };
            if let Some(line) = forwarded_line(&input, host) {
                send(&line);
            }
        }
    }
    true
}

/// What the hook's environment says about the session.
#[derive(Default)]
struct Host {
    project_dir: Option<String>,
    app: Option<String>,
    tty: Option<String>,
}

/// A terminal device path as macOS names them: "/dev/ttys" and digits.
fn tty_path(text: &str) -> bool {
    text.strip_prefix("/dev/ttys").is_some_and(|number| !number.is_empty() && number.len() <= 4 && number.bytes().all(|byte| byte.is_ascii_digit()))
}

/// The terminal the hook's process or one of its parents (the shell, Claude Code) is attached to.
fn controlling_tty() -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let mut pid = std::process::id() as libc::c_int;
    let device = (0..TTY_ANCESTORS).find_map(|_| {
        // SAFETY: proc_bsdinfo is plain data, and proc_pidinfo writes at most `size` bytes into it.
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        let got = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&raw mut info).cast(), size) };
        if got != size {
            pid = 0;
            return None;
        }
        pid = info.pbi_ppid as libc::c_int;
        // No terminal reads as all ones (NODEV).
        (info.e_tdev != u32::MAX && info.e_tdev != 0).then_some(info.e_tdev)
    })?;
    fs::read_dir("/dev").ok()?.flatten().find_map(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = format!("/dev/{name}");
        (tty_path(&path) && entry.metadata().is_ok_and(|meta| meta.rdev() as u32 == device)).then_some(path)
    })
}

/// The line to forward, or None for an event the pet does not show or input it cannot read.
fn forwarded_line(input: &[u8], host: Host) -> Option<String> {
    let hook: HookInput = serde_json::from_slice(input).ok()?;
    if !EVENTS.contains(&hook.hook_event_name.as_str()) {
        return None;
    }
    // The working folder follows the shell's `cd` into a subfolder; the project folder does not.
    let folder = host.project_dir.filter(|dir| !dir.is_empty()).unwrap_or(hook.cwd);
    let event = hook.hook_event_name.as_str();
    let prompt = hook.prompt.as_deref().filter(|_| event == "UserPromptSubmit");
    let woke = prompt.is_some_and(|prompt| prompt.trim_start().starts_with(TASK_NOTIFICATION));
    let work = Work {
        at: now_ms(),
        task: prompt.filter(|_| !woke).and_then(|prompt| one_line(prompt, MAX_TASK_CHARS)),
        title: hook.session_title.as_deref().and_then(|title| one_line(title, MAX_TASK_CHARS)),
        detail: match (&hook.tool_name, &hook.tool_input) {
            (Some(tool), Some(input)) if matches!(event, "PreToolUse" | "PermissionRequest") => tool_detail(tool, input),
            _ => None,
        },
        branch: git_branch(Path::new(&folder)),
        summary: hook.last_assistant_message.as_deref().filter(|_| event == "Stop").and_then(|reply| one_line(reply, MAX_SUMMARY_CHARS)),
        background: event == "Stop" && hook.background_tasks.is_some_and(|tasks| !tasks.is_empty()),
        woke,
    };
    let project = Path::new(&folder).file_name().map(|name| cut(name.to_string_lossy().into_owned(), MAX_FORWARDED_CHARS)).unwrap_or_default();
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
        // Run from the pet itself (a test from its settings) there is nothing to go back to.
        app: host.app.filter(|app| app_id(app) && app != IDENTIFIER),
        tty: host.tty.filter(|tty| tty_path(tty)),
        work,
    };
    serde_json::to_string(&forwarded).ok()
}

/// A bundle identifier such as "com.apple.Terminal": what `open -b` is given, so nothing that reads as an option.
fn app_id(text: &str) -> bool {
    text.contains('.')
        && !text.starts_with(['-', '.'])
        && text.chars().count() <= MAX_APP_ID_CHARS
        && text.chars().all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '-' | '_'))
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
    *app.state::<AgentHooks>().sessions.lock().unwrap_or_else(PoisonError::into_inner) = sessions_path().map(|path| load_sessions(&path)).unwrap_or_default();
    let app = app.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if let Some(forwarded) = read_line(stream) {
                take(&app, forwarded);
            }
        }
    });
}

/// The sessions kept by the last run. Each path and app is checked again, as when it first came in.
fn load_sessions(path: &Path) -> HashMap<String, Followed> {
    let Ok(text) = fs::read_to_string(path) else { return HashMap::new() };
    let kept: HashMap<String, Followed> = serde_json::from_str(&text).unwrap_or_default();
    kept.into_iter()
        .filter(|(session, _)| session_id(session))
        .map(|(session, followed)| {
            let transcript = followed.transcript.as_deref().and_then(Path::to_str).and_then(transcript_path);
            (session, Followed { transcript, app: followed.app.filter(|app| app_id(app)), tty: followed.tty.filter(|tty| tty_path(tty)), since: followed.since })
        })
        .take(MAX_SESSIONS)
        .collect()
}

/// Written to a temporary file and renamed over the old one, so a crash mid-write cannot leave half a file.
fn save_sessions(path: &Path, sessions: &HashMap<String, Followed>) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let text = serde_json::to_string(sessions)?;
    let temp = path.with_extension("tmp");
    fs::OpenOptions::new().write(true).create(true).truncate(true).mode(PRIVATE_FILE_MODE).open(&temp)?.write_all(text.as_bytes())?;
    fs::rename(&temp, path)
}

/// Forgets the session heard of longest ago, to make room for a new one.
fn forget_oldest(sessions: &mut HashMap<String, Followed>) {
    if let Some(oldest) = sessions.iter().min_by_key(|(_, followed)| followed.since).map(|(session, _)| session.clone()) {
        sessions.remove(&oldest);
    }
}

pub(crate) fn bind(path: &Path) -> std::io::Result<UnixListener> {
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
    // The hook writes its line and exits, usually before this runs. macOS then refuses the
    // timeout with EINVAL; the line is still there to read, and a closed peer cannot make the read wait.
    match stream.set_read_timeout(Some(SOCKET_TIMEOUT)) {
        Err(error) if error.kind() != std::io::ErrorKind::InvalidInput => return None,
        _ => {}
    }
    let mut line = String::new();
    BufReader::new(stream.take(MAX_LINE)).read_line(&mut line).ok()?;
    let forwarded: Forwarded = serde_json::from_str(line.trim()).ok()?;
    valid(&forwarded).then_some(forwarded)
}

fn valid(forwarded: &Forwarded) -> bool {
    let short = |text: &Option<String>, max: usize| text.as_ref().is_none_or(|text| !text.is_empty() && text.chars().count() <= max);
    EVENTS.contains(&forwarded.event.as_str())
        && session_id(&forwarded.session)
        && forwarded.project.chars().count() <= MAX_NAME_CHARS
        && short(&forwarded.work.task, MAX_TASK_CHARS)
        && short(&forwarded.work.title, MAX_TASK_CHARS)
        && short(&forwarded.work.detail, MAX_FORWARDED_CHARS)
        && short(&forwarded.work.branch, MAX_FORWARDED_CHARS)
        && short(&forwarded.work.summary, MAX_SUMMARY_CHARS)
        && short(&forwarded.tool, MAX_NAME_CHARS)
        && short(&forwarded.notification, MAX_KIND_CHARS)
        && short(&forwarded.error, MAX_KIND_CHARS)
        && forwarded.app.as_deref().is_none_or(app_id)
        && forwarded.tty.as_deref().is_none_or(tty_path)
}

fn session_id(text: &str) -> bool {
    !text.is_empty() && text.len() <= MAX_ID_CHARS && text.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn take(app: &AppHandle, forwarded: Forwarded) {
    let hooks = app.state::<AgentHooks>();
    hooks.last_report.store(now_ms(), Ordering::Relaxed);
    let revealable = {
        let mut sessions = hooks.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        let before = sessions.get(&forwarded.session).cloned();
        let revealable = if forwarded.event == "SessionEnd" {
            sessions.remove(&forwarded.session);
            false
        } else {
            if sessions.len() >= MAX_SESSIONS && before.is_none() {
                forget_oldest(&mut sessions);
            }
            let followed = sessions.entry(forwarded.session.clone()).or_insert_with(|| Followed { since: now_ms(), ..Followed::default() });
            if let Some(path) = forwarded.transcript.as_deref().and_then(transcript_path) {
                followed.transcript = Some(path);
            }
            if let Some(host) = &forwarded.app {
                followed.app = Some(host.clone());
                // Resumed somewhere else: the old terminal no longer has it.
                followed.tty = forwarded.tty.clone();
            }
            followed.app.is_some()
        };
        // Kept for the next run, so a restarted pet can still check on the session and find its terminal.
        if before.as_ref() != sessions.get(&forwarded.session) {
            if let Some(path) = sessions_path() {
                if let Err(error) = save_sessions(&path, &sessions) {
                    log::warn!("Could not keep the Claude Code sessions for the next run: {}", error.kind());
                }
            }
        }
        revealable
    };
    let report = Report {
        event: forwarded.event,
        session: forwarded.session,
        project: forwarded.project,
        tool: forwarded.tool,
        notification: forwarded.notification,
        error: forwarded.error,
        subagent: forwarded.subagent,
        revealable,
        work: forwarded.work,
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

/// How the session's turn ended after `since` (milliseconds), by its transcript:
/// "interrupted" (Esc), "ended" (a Stop that may not have reached the pet), or None while it goes on.
#[tauri::command]
pub fn agent_turn_over(app: AppHandle, session: String, since: f64) -> Option<&'static str> {
    let path = app.state::<AgentHooks>().sessions.lock().unwrap_or_else(PoisonError::into_inner).get(&session).and_then(|followed| followed.transcript.clone())?;
    match tail(&path) {
        Ok(text) => turn_over_after(&text, since),
        Err(error) => {
            log::warn!("Could not read the end of a Claude Code transcript: {}", error.kind());
            None
        }
    }
}

/// Claude Code's own name for the session, from the end of its transcript; None when it has not written one there.
#[tauri::command]
pub fn agent_title(app: AppHandle, session: String) -> Option<String> {
    let path = app.state::<AgentHooks>().sessions.lock().unwrap_or_else(PoisonError::into_inner).get(&session).and_then(|followed| followed.transcript.clone())?;
    title_in(&tail(&path).ok()?)
}

/// The last title line in `tail`. The first line may be cut and is skipped by the parse.
fn title_in(tail: &str) -> Option<String> {
    tail.lines()
        .filter(|line| line.contains(TITLE_MARK))
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry.get("type").and_then(Value::as_str) == Some(TITLE_MARK))
        .filter_map(|entry| entry.get(TITLE_FIELD).and_then(Value::as_str).and_then(|title| one_line(title, MAX_TASK_CHARS)))
        .last()
}

/// Brings the session's terminal to the front: in Ghostty its own window and tab, elsewhere the app.
/// Rejects with a message for the user. Async, and the waiting on `osascript` or `open` is on a blocking thread.
#[tauri::command]
pub async fn agent_reveal(app: AppHandle, window: tauri::WebviewWindow, session: String) -> Result<(), String> {
    const NOT_FOUND: &str = "找不到这个会话所在的终端。";
    let followed = app.state::<AgentHooks>().sessions.lock().unwrap_or_else(PoisonError::into_inner).get(&session).cloned();
    let Followed { app: host, tty, .. } = followed.unwrap_or_default();
    let host = host.ok_or(NOT_FOUND)?;
    let from = window.label().to_owned();
    // An async command still runs on the async runtime: the blocking waits go to their own thread.
    tauri::async_runtime::spawn_blocking(move || {
        // The panel the click came from holds the keyboard. With the terminal's app already in front,
        // bringing it forward would leave it with us: typing would not reach the terminal, nor would the ring wait end.
        #[cfg(target_os = "macos")]
        crate::hand_keyboard_back(&app, &from);
        if let (GHOSTTY, Some(tty)) = (host.as_str(), tty.as_deref()) {
            match focus_ghostty(tty) {
                Ok(true) => {
                    #[cfg(target_os = "macos")]
                    crate::split_highlight::flash(&app, GHOSTTY);
                    return Ok(());
                }
                // Closed since, or the user said no to letting AI Pet control Ghostty: the app is the next best thing.
                Ok(false) => log::warn!("No Ghostty terminal on the session's device any more; bringing Ghostty forward"),
                Err(error) => log::warn!("Could not focus the session's Ghostty terminal: {error}"),
            }
        }
        match std::process::Command::new("/usr/bin/open").args(["-b", &host]).output() {
            Ok(output) if output.status.success() => Ok(()),
            Ok(output) => {
                log::warn!("Could not bring {host} forward: {}", String::from_utf8_lossy(&output.stderr).trim());
                Err(NOT_FOUND.into())
            }
            Err(error) => {
                log::error!("Could not run open for {host}: {error}");
                Err(NOT_FOUND.into())
            }
        }
    })
    .await
    .map_err(|_| NOT_FOUND.to_string())?
}

/// Asks Ghostty to focus its terminal on `tty`. Ok(false) when it has none; Err when it could not be asked.
/// The first time, macOS asks the user whether AI Pet may control Ghostty.
fn focus_ghostty(tty: &str) -> Result<bool, String> {
    let output = std::process::Command::new("/usr/bin/osascript").args(["-e", GHOSTTY_FOCUS, tty]).output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim() == "focused")
}

fn tail(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(TAIL_BYTES)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// The last of Claude Code's own interruption marks (a user line) and turn ends (a system line)
/// written after `since`. The first line may be cut and is skipped by the parse.
fn turn_over_after(tail: &str, since: f64) -> Option<&'static str> {
    tail.lines()
        .filter(|line| line.contains(INTERRUPT_MARK) || line.contains(TURN_END_MARK))
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry.get("timestamp").and_then(Value::as_str).and_then(epoch_ms).is_some_and(|at| at > since))
        .filter_map(|entry| match entry.get("type").and_then(Value::as_str) {
            Some("user") if is_mark(entry.pointer("/message/content")) => Some("interrupted"),
            Some("system") if entry.get("subtype").and_then(Value::as_str) == Some(TURN_END_MARK) => Some("ended"),
            _ => None,
        })
        .last()
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
        let line = forwarded_line(HOOK.as_bytes(), Host::default()).unwrap();
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
        let forwarded: Forwarded = serde_json::from_str(&forwarded_line(hook.as_bytes(), Host::default()).unwrap()).unwrap();
        assert!(forwarded.subagent);
        assert_eq!(forwarded.project.chars().count(), MAX_FORWARDED_CHARS);
    }

    #[test]
    fn skips_events_it_does_not_show_and_input_it_cannot_read() {
        assert!(forwarded_line(HOOK.replace("PermissionRequest", "SubagentStop").as_bytes(), Host::default()).is_none());
        assert!(forwarded_line(b"not json", Host::default()).is_none());
    }

    #[test]
    fn takes_a_failure_kind_given_as_text_or_as_an_object() {
        let text = HOOK.replace("PermissionRequest", "StopFailure").replace(r#""tool_name":"Bash""#, r#""error":"rate_limit""#);
        assert_eq!(serde_json::from_str::<Forwarded>(&forwarded_line(text.as_bytes(), Host::default()).unwrap()).unwrap().error.as_deref(), Some("rate_limit"));
        let object = HOOK.replace("PermissionRequest", "StopFailure").replace(r#""tool_name":"Bash""#, r#""error":{"type":"server_error"}"#);
        assert_eq!(serde_json::from_str::<Forwarded>(&forwarded_line(object.as_bytes(), Host::default()).unwrap()).unwrap().error.as_deref(), Some("server_error"));
    }

    #[test]
    fn reads_a_line_from_a_hook_that_already_left() {
        let (mut hook, app) = UnixStream::pair().unwrap();
        hook.write_all(br#"{"event":"Stop","session":"abc-123","project":"p"}"#).unwrap();
        // The hook process writes and exits before the app gets to the connection.
        drop(hook);
        assert_eq!(read_line(app).map(|forwarded| forwarded.event).as_deref(), Some("Stop"));
    }

    #[test]
    fn refuses_odd_lines_on_the_socket() {
        let good = Forwarded { event: "Stop".into(), session: "abc-123".into(), project: "p".into(), tool: None, notification: None, error: None, subagent: false, transcript: None, app: None, tty: None, work: Work::default() };
        assert!(valid(&good));
        assert!(!valid(&Forwarded { event: "SubagentStop".into(), ..clone(&good) }));
        assert!(!valid(&Forwarded { work: Work { task: Some("长".repeat(MAX_TASK_CHARS + 1)), ..Work::default() }, ..clone(&good) }));
        assert!(!valid(&Forwarded { session: "../x".into(), ..clone(&good) }));
        assert!(!valid(&Forwarded { session: "a".repeat(MAX_ID_CHARS + 1), ..clone(&good) }));
        assert!(!valid(&Forwarded { tool: Some(String::new()), ..clone(&good) }));
        assert!(valid(&Forwarded { app: Some("com.apple.Terminal".into()), ..clone(&good) }));
        assert!(!valid(&Forwarded { app: Some("-a Calculator".into()), ..clone(&good) }));
        assert!(!valid(&Forwarded { app: Some("Terminal".into()), ..clone(&good) }));
        assert!(valid(&Forwarded { tty: Some("/dev/ttys012".into()), ..clone(&good) }));
        for odd in ["/dev/tty", "/dev/ttys", "/dev/ttys01a", "/etc/passwd", "/dev/ttys012\" & say \"x"] {
            assert!(!valid(&Forwarded { tty: Some(odd.into()), ..clone(&good) }), "{odd}");
        }
    }

    #[test]
    fn says_what_a_turn_is_about_in_one_line_each() {
        let asked = r##"{"session_id":"abc-123","cwd":"/tmp/none","hook_event_name":"UserPromptSubmit","prompt":"<pasted_content id=\"1\">\n\n## 重构  设置页面\n第二行不要","session_title":"设置页"}"##;
        let forwarded: Forwarded = serde_json::from_str(&forwarded_line(asked.as_bytes(), Host::default()).unwrap()).unwrap();
        assert_eq!(forwarded.work.task.as_deref(), Some("重构 设置页面"));
        assert_eq!(forwarded.work.title.as_deref(), Some("设置页"));
        assert!(forwarded.work.at > 0 && valid(&forwarded));

        let ended = r#"{"session_id":"abc-123","cwd":"/tmp/none","hook_event_name":"Stop","last_assistant_message":"\n**设置页改好了**，`pnpm test` 通过。\n\n细节……"}"#;
        let forwarded: Forwarded = serde_json::from_str(&forwarded_line(ended.as_bytes(), Host::default()).unwrap()).unwrap();
        assert_eq!(forwarded.work.summary.as_deref(), Some("设置页改好了，pnpm test 通过。"));
        // A failed turn's last message is the API's error text, which the pet words itself.
        assert!(!forwarded_line(ended.replace("\"Stop\"", "\"StopFailure\"").as_bytes(), Host::default()).unwrap().contains("summary"));
    }

    #[test]
    fn tells_a_turn_left_running_in_the_background_and_its_wake_up() {
        // Both shaped as Claude Code 2.1.331 sent them.
        let stopped = r#"{"session_id":"abc-123","cwd":"/tmp/none","hook_event_name":"Stop","last_assistant_message":"STARTED","background_tasks":[{"id":"ba0oc3oax","type":"shell","status":"running","description":"sleep 300","command":"sleep 300 && rm -rf dist"}],"session_crons":[]}"#;
        let line = forwarded_line(stopped.as_bytes(), Host::default()).unwrap();
        let forwarded: Forwarded = serde_json::from_str(&line).unwrap();
        assert!(forwarded.work.background && valid(&forwarded));
        assert!(!line.contains("sleep") && !line.contains("rm -rf") && !line.contains("ba0oc3oax"));
        let idle = stopped.replace(r#"[{"id":"ba0oc3oax","type":"shell","status":"running","description":"sleep 300","command":"sleep 300 && rm -rf dist"}]"#, "[]");
        assert!(!forwarded_line(idle.as_bytes(), Host::default()).unwrap().contains("background"));

        let woke = r#"{"session_id":"abc-123","cwd":"/tmp/none","hook_event_name":"UserPromptSubmit","prompt":"<task-notification>\n<task-id>blhxbdq9r</task-id>\n<output-file>/private/tmp/claude-501/tasks/blhxbdq9r.output</output-file>\n<status>completed</status>\n<summary>Background command \"sleep 12\" completed (exit code 0)</summary>\n</task-notification>\nRead the output file to retrieve the result: /private/tmp/claude-501/tasks/blhxbdq9r.output"}"#;
        let line = forwarded_line(woke.as_bytes(), Host::default()).unwrap();
        let forwarded: Forwarded = serde_json::from_str(&line).unwrap();
        assert!(forwarded.work.woke && forwarded.work.task.is_none() && valid(&forwarded));
        assert!(!line.contains("/private") && !line.contains("sleep"));
        let asked = r#"{"session_id":"abc-123","cwd":"/tmp/none","hook_event_name":"UserPromptSubmit","prompt":"why is <task-notification> in the log"}"#;
        assert!(!forwarded_line(asked.as_bytes(), Host::default()).unwrap().contains("woke"));
    }

    #[test]
    fn names_a_tools_file_or_step_and_never_its_command() {
        let pre = |tool: &str, input: &str| {
            let hook = format!(r#"{{"session_id":"abc-123","cwd":"/tmp/none","hook_event_name":"PreToolUse","tool_name":"{tool}","tool_input":{input}}}"#);
            forwarded_line(hook.as_bytes(), Host::default()).unwrap()
        };
        let edit = pre("Edit", r#"{"file_path":"/Users/me/work/src/SettingsView.tsx","old_string":"secret code"}"#);
        assert!(edit.contains(r#""detail":"SettingsView.tsx""#) && !edit.contains("secret") && !edit.contains("/Users/me"));
        let bash = pre("Bash", r#"{"command":"rm -rf dist","description":"Clean the build folder"}"#);
        assert!(bash.contains(r#""detail":"Clean the build folder""#) && !bash.contains("rm -rf"));
        assert!(!pre("Bash", r#"{"command":"rm -rf dist"}"#).contains("detail"));
        assert!(!pre("Grep", r#"{"pattern":"password"}"#).contains("password"));
        // Only before the tool runs or while it asks: afterwards its output comes along and nothing of it is kept.
        let post = r#"{"session_id":"abc-123","cwd":"/tmp/none","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"/a/b.ts"}}"#;
        assert!(!forwarded_line(post.as_bytes(), Host::default()).unwrap().contains("detail"));
    }

    #[test]
    fn reads_the_branch_of_a_checkout_and_of_a_worktree() {
        let root = std::env::temp_dir().join(format!("ai-pet-branch-{}", std::process::id()));
        let (repo, tree) = (root.join("repo"), root.join("tree"));
        fs::create_dir_all(repo.join(".git/worktrees/tree")).unwrap();
        fs::create_dir_all(&tree).unwrap();
        fs::write(repo.join(".git/HEAD"), "ref: refs/heads/feat/settings\n").unwrap();
        fs::write(repo.join(".git/worktrees/tree/HEAD"), "0123456789abcdef0123456789abcdef01234567\n").unwrap();
        fs::write(tree.join(".git"), format!("gitdir: {}\n", repo.join(".git/worktrees/tree").display())).unwrap();
        assert_eq!(git_branch(&repo).as_deref(), Some("feat/settings"));
        assert_eq!(git_branch(&tree).as_deref(), Some("0123456"));
        assert_eq!(git_branch(&root), None);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_claude_codes_own_title_for_the_session() {
        let tail = concat!(
            "tle\":\"cut line\"}\n",
            "{\"type\":\"ai-title\",\"aiTitle\":\"旧标题\",\"sessionId\":\"s\"}\n",
            "{\"type\":\"user\",\"message\":{\"content\":\"说到 ai-title 这个词\"}}\n",
            "{\"type\":\"ai-title\",\"aiTitle\":\"Roadmap 未完成事项\",\"sessionId\":\"s\"}\n",
        );
        assert_eq!(title_in(tail).as_deref(), Some("Roadmap 未完成事项"));
        assert_eq!(title_in("{\"type\":\"user\"}\n"), None);
    }

    #[test]
    fn keeps_sessions_for_the_next_run_and_checks_them_again() {
        let home = std::env::var("HOME").unwrap();
        let path = std::env::temp_dir().join(format!("ai-pet-sessions-{}.json", std::process::id()));
        let transcript = PathBuf::from(format!("{home}/.claude/projects/p/abc-123.jsonl"));
        let mut sessions = HashMap::new();
        sessions.insert("abc-123".to_owned(), Followed { transcript: Some(transcript.clone()), app: Some("com.apple.Terminal".into()), tty: Some("/dev/ttys004".into()), since: 7 });
        sessions.insert("def-456".to_owned(), Followed { transcript: Some("/etc/passwd".into()), app: Some("-a Calculator".into()), tty: Some("/etc/hosts".into()), since: 0 });
        sessions.insert("../x".to_owned(), Followed::default());
        save_sessions(&path, &sessions).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, PRIVATE_FILE_MODE);
        let loaded = load_sessions(&path);
        assert_eq!(loaded.len(), 2);
        assert!(loaded["abc-123"] == Followed { transcript: Some(transcript), app: Some("com.apple.Terminal".into()), tty: Some("/dev/ttys004".into()), since: 7 });
        assert!(loaded["def-456"] == Followed::default());
        assert!(!path.with_extension("tmp").exists());
        fs::remove_file(&path).unwrap();
        assert!(load_sessions(&path).is_empty());
    }

    #[test]
    fn makes_room_by_forgetting_only_the_oldest_session() {
        let mut sessions: HashMap<String, Followed> =
            (0..MAX_SESSIONS as u64).map(|at| (format!("s-{at}"), Followed { tty: Some("/dev/ttys001".into()), since: 100 + at, ..Followed::default() })).collect();
        forget_oldest(&mut sessions);
        assert_eq!(sessions.len(), MAX_SESSIONS - 1);
        assert!(!sessions.contains_key("s-0"));
        assert_eq!(sessions["s-1"].tty.as_deref(), Some("/dev/ttys001"));
    }

    #[test]
    fn finds_the_terminal_its_process_is_attached_to_or_none() {
        // Run from a terminal this names its device; under a build server with no terminal, nothing.
        if let Some(tty) = controlling_tty() {
            assert!(tty_path(&tty), "{tty}");
        }
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

    fn interrupted(tail: &str, since: f64) -> bool {
        turn_over_after(tail, since) == Some("interrupted")
    }

    #[test]
    fn finds_an_interruption_written_after_the_last_event() {
        let before = epoch_ms("2026-11-21T01:22:52.000Z").unwrap();
        let after = epoch_ms("2026-11-21T01:23:30.000Z").unwrap();
        assert!(interrupted(TAIL, before));
        assert!(!interrupted(TAIL, after));
        assert!(!interrupted("{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":\"x\"}\n", before));
        assert!(interrupted("{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":\"[Request interrupted by user]\"}}\n", before));
        // A cut first line, the words in Claude's own reply, or a tool's output carrying them is not taken for the mark.
        assert!(!interrupted("t\":\"[Request interrupted by user\"}\n", before));
        assert!(!interrupted("{\"type\":\"assistant\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"[Request interrupted by user\"}]}}\n", before));
        assert!(!interrupted("{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":[{\"type\":\"tool_result\",\"content\":\"[Request interrupted by user]\"}]}}\n", before));
        assert!(!interrupted("{\"type\":\"user\",\"timestamp\":\"2026-11-21T01:23:24.056Z\",\"message\":{\"content\":\"see [Request interrupted by user]\"}}\n", before));
    }

    // The end of a normal turn as Claude Code 2.1.330 wrote it.
    const ENDED: &str = concat!(
        "{\"type\":\"assistant\",\"timestamp\":\"2026-11-22T09:34:24.872Z\",\"message\":{\"stop_reason\":\"end_turn\",\"content\":[]}}\n",
        "{\"type\":\"system\",\"subtype\":\"stop_hook_summary\",\"timestamp\":\"2026-11-22T09:34:31.359Z\"}\n",
        "{\"type\":\"system\",\"subtype\":\"turn_duration\",\"timestamp\":\"2026-11-22T09:34:31.366Z\"}\n",
        "{\"type\":\"cost-state\"}\n",
    );

    #[test]
    fn finds_a_turn_that_ended_after_the_last_event() {
        let before = epoch_ms("2026-11-22T09:34:20.000Z").unwrap();
        assert_eq!(turn_over_after(ENDED, before), Some("ended"));
        assert_eq!(turn_over_after(ENDED, epoch_ms("2026-11-22T09:34:40.000Z").unwrap()), None);
        // Whichever came last tells how the turn is over.
        let then_interrupted = format!("{ENDED}{}", TAIL.replace("2026-11-21T01:23:24.056Z", "2026-11-22T09:35:00.000Z"));
        assert_eq!(turn_over_after(&then_interrupted, before), Some("interrupted"));
    }

    #[test]
    fn names_the_project_folder_and_the_app_from_the_hooks_environment() {
        let host = Host { project_dir: Some("/Users/me/work/ai-pet".into()), app: Some("com.mitchellh.ghostty".into()), tty: Some("/dev/ttys012".into()) };
        let line = forwarded_line(HOOK.replace("/work/ai-pet\"", "/work/ai-pet/src-tauri\"").as_bytes(), host).unwrap();
        let forwarded: Forwarded = serde_json::from_str(&line).unwrap();
        assert_eq!(forwarded.project, "ai-pet");
        assert_eq!(forwarded.app.as_deref(), Some("com.mitchellh.ghostty"));
        assert_eq!(forwarded.tty.as_deref(), Some("/dev/ttys012"));
        // Without it the working folder still names the session; an app that is the pet itself or not an identifier is left out.
        let own = Host { project_dir: None, app: Some(IDENTIFIER.into()), tty: Some("/dev/null".into()) };
        let forwarded: Forwarded = serde_json::from_str(&forwarded_line(HOOK.as_bytes(), own).unwrap()).unwrap();
        assert_eq!((forwarded.project.as_str(), forwarded.app, forwarded.tty), ("ai-pet", None, None));
        let odd = Host { project_dir: Some(String::new()), app: Some("--args x".into()), tty: None };
        assert!(!forwarded_line(HOOK.as_bytes(), odd).unwrap().contains("args"));
    }
}

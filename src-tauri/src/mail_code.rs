//! "查收验证码" in the pet menu: waits up to two minutes for a verification
//! code in the user's 163 inbox, copies it and tells the pet window.
//!
//! The inbox is opened read-only (EXAMINE and BODY.PEEK), so nothing is marked
//! as read. Mail is looked at only while the user waits, never stored, and
//! never sent anywhere; the address and authorization code live in the keychain.
//! IMAP is plain TCP, so unlike the curl requests it does not use the system proxy.

use std::{
    collections::HashSet,
    fmt::Display,
    net::{TcpStream, ToSocketAddrs},
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use native_tls::{TlsConnector, TlsStream};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use crate::mail_extract::{self, Verdict};

/// Tells the pet window how a wait went. Must match `src/platform/mailCode.ts`.
const EVENT: &str = "pet://mail-code";
const HOST: &str = "imap.163.com";
const PORT: u16 = 993;
const DOMAIN: &str = "@163.com";
const WAIT_FOR: Duration = Duration::from_secs(120);
const CHECK_EVERY: Duration = Duration::from_secs(5);
/// How often a wait looks at the cancel flag between two checks.
const CANCEL_POLL: Duration = Duration::from_millis(250);
/// Only mail this recent counts; an older code has most likely expired.
const FRESH_SECS: i64 = 10 * 60;
/// The newest messages looked at on each check.
const RECENT_MESSAGES: u32 = 10;
/// Bigger messages carry attachments, not codes, and are not downloaded.
const MAX_MESSAGE_BYTES: u32 = 512 * 1024;
const NETWORK_TIMEOUT: Duration = Duration::from_secs(15);
/// 163 refuses to open a mailbox ("Unsafe Login") until the client names itself with the IMAP ID command (RFC 2971).
const CLIENT_ID: &str = r#"ID ("name" "AI Pet" "version" "1.0" "vendor" "AI Pet")"#;
/// Asks clipboard managers to keep the code out of their history; see nspasteboard.org.
#[cfg(target_os = "macos")]
const CONCEALED_TYPE: &str = "org.nspasteboard.ConcealedType";
const MAX_ADDRESS_CHARS: usize = 254;
const MAX_PASSWORD_CHARS: usize = 64;

const NOT_163: &str = "目前只支持 163 邮箱，地址要以 @163.com 结尾。";
const BAD_PASSWORD: &str = "授权码格式不对，请重新复制再粘贴。";
const LOGIN_REFUSED: &str = "163 邮箱登录失败：授权码不对，或者还没开启 IMAP 服务。";
const NETWORK_ERROR: &str = "连不上 163 邮箱，检查一下网络。";
const MAIL_ERROR: &str = "163 邮箱出了点问题，请稍后再试。";
const BROKEN_ACCOUNT: &str = "邮箱设置坏了，请在设置里重新添加。";

type Session = imap::Session<TlsStream<TcpStream>>;

#[derive(Default)]
pub struct MailCodeState {
    /// Set while a wait runs; storing true in it asks the wait to stop.
    running: Mutex<Option<Arc<AtomicBool>>>,
    /// Messages already handed over, so after "resend" the new code is waited for instead of the old one given again.
    delivered: Mutex<HashSet<u32>>,
}

struct Account {
    address: String,
    password: String,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn service(app: &AppHandle) -> String {
    format!("{}.mail.163", app.config().identifier)
}

fn load_account(app: &AppHandle) -> Result<Option<Account>, String> {
    let Some(text) = crate::secrets::load(&service(app))? else {
        return Ok(None);
    };
    let value: Value = serde_json::from_str(&text).map_err(|_| BROKEN_ACCOUNT.to_string())?;
    match (value["address"].as_str(), value["password"].as_str()) {
        (Some(address), Some(password)) => Ok(Some(Account { address: address.into(), password: password.into() })),
        _ => Err(BROKEN_ACCOUNT.into()),
    }
}

/// A new mailbox has its own message numbers.
fn forget_delivered(app: &AppHandle) {
    lock(&app.state::<MailCodeState>().delivered).clear();
}

fn validate(address: &str, password: &str) -> Result<(), String> {
    let local = address.strip_suffix(DOMAIN).unwrap_or_default();
    if local.is_empty() || local.contains('@') || address.len() > MAX_ADDRESS_CHARS || !address.chars().all(|c| c.is_ascii_graphic()) {
        return Err(NOT_163.into());
    }
    if password.is_empty() || password.len() > MAX_PASSWORD_CHARS || !password.chars().all(|c| c.is_ascii_graphic()) {
        return Err(BAD_PASSWORD.into());
    }
    Ok(())
}

/// The saved 163 address, or None when no mailbox is set up.
#[tauri::command]
pub fn mail_account(app: AppHandle) -> Result<Option<String>, String> {
    Ok(load_account(&app)?.map(|account| account.address))
}

/// Logs in with the address and authorization code, and saves them only when 163 lets us in.
#[tauri::command]
pub async fn mail_save_account(app: AppHandle, address: String, password: String) -> Result<(), String> {
    let address = address.trim().to_lowercase();
    let password = crate::secrets::clean_pasted_key(&password);
    validate(&address, &password)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect(&address, &password)?;
        session.examine("INBOX").map_err(|error| failure("open the inbox", error))?;
        let _ = session.logout();
        crate::secrets::save(&service(&app), &json!({ "address": address, "password": password }).to_string())?;
        forget_delivered(&app);
        Ok(())
    })
    .await
    .map_err(|error| {
        eprintln!("Mail account check stopped: {error}");
        MAIL_ERROR.to_string()
    })?
}

#[tauri::command]
pub fn mail_remove_account(app: AppHandle) -> Result<(), String> {
    crate::secrets::clear(&service(&app))?;
    forget_delivered(&app);
    Ok(())
}

fn network(step: &str, error: impl Display) -> String {
    eprintln!("Mail: failed to {step}: {error}");
    NETWORK_ERROR.into()
}

fn failure(step: &str, error: imap::error::Error) -> String {
    match error {
        imap::error::Error::Io(_) | imap::error::Error::Tls(_) | imap::error::Error::ConnectionLost => network(step, error),
        other => {
            eprintln!("Mail: failed to {step}: {other}");
            MAIL_ERROR.into()
        }
    }
}

fn connect(address: &str, password: &str) -> Result<Session, String> {
    let target = (HOST, PORT)
        .to_socket_addrs()
        .map_err(|error| network("look up the server", error))?
        .next()
        .ok_or_else(|| network("look up the server", "no address"))?;
    let tcp = TcpStream::connect_timeout(&target, NETWORK_TIMEOUT).map_err(|error| network("connect", error))?;
    tcp.set_read_timeout(Some(NETWORK_TIMEOUT))
        .and_then(|()| tcp.set_write_timeout(Some(NETWORK_TIMEOUT)))
        .map_err(|error| network("set timeouts", error))?;
    let tls = TlsConnector::new()
        .map_err(|error| network("start TLS", error))?
        .connect(HOST, tcp)
        .map_err(|error| network("start TLS", error))?;
    let mut client = imap::Client::new(tls);
    client.read_greeting().map_err(|error| failure("read the greeting", error))?;
    let mut session = client.login(address, password).map_err(|(error, _)| match error {
        imap::error::Error::No(_) | imap::error::Error::Bad(_) => {
            eprintln!("Mail: login refused: {error}");
            LOGIN_REFUSED.to_string()
        }
        other => failure("log in", other),
    })?;
    session.run_command_and_check_ok(CLIENT_ID).map_err(|error| failure("send ID", error))?;
    Ok(session)
}

fn emit(app: &AppHandle, payload: Value) {
    if let Err(error) = app.emit_to(crate::MAIN_WINDOW, EVENT, payload) {
        eprintln!("Mail: failed to tell the pet window: {error}");
    }
}

/// Starts waiting for a code, or stops the wait that is running. Called from the pet menu.
pub fn toggle(app: &AppHandle) {
    let state = app.state::<MailCodeState>();
    let mut running = lock(&state.running);
    if let Some(cancel) = running.take() {
        cancel.store(true, Ordering::Relaxed);
        drop(running);
        crate::sync_mail_code_menu(app, false);
        emit(app, json!({ "kind": "cancelled" }));
        return;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *running = Some(cancel.clone());
    drop(running);
    crate::sync_mail_code_menu(app, true);
    // Sent here rather than from the wait, so it can never arrive after "cancelled".
    emit(app, json!({ "kind": "waiting" }));
    let app = app.clone();
    thread::spawn(move || {
        let outcome = wait_for_code(&app, &cancel);
        let state = app.state::<MailCodeState>();
        let mut running = lock(&state.running);
        // A cancelled wait has already been answered by `toggle`.
        if !running.as_ref().is_some_and(|current| Arc::ptr_eq(current, &cancel)) {
            return;
        }
        *running = None;
        drop(running);
        crate::sync_mail_code_menu(&app, false);
        if let Some(payload) = outcome {
            // The user may have asked from the tray with the pet hidden.
            let handle = app.clone();
            if let Err(error) = app.run_on_main_thread(move || crate::show_pet_if_hidden(&handle)) {
                eprintln!("Mail: failed to show the pet: {error}");
            }
            emit(&app, payload);
        }
    });
}

/// What came of the wait, or None when it was cancelled.
fn wait_for_code(app: &AppHandle, cancel: &AtomicBool) -> Option<Value> {
    let account = match load_account(app) {
        Ok(Some(account)) => account,
        Ok(None) => return Some(json!({ "kind": "unset" })),
        Err(message) => return Some(failed(message)),
    };
    let mut session = match connect(&account.address, &account.password) {
        Ok(session) => session,
        Err(message) => return Some(failed(message)),
    };
    // One login for the whole wait: logging in again every few seconds can trip 163's checks.
    let outcome = watch_inbox(app, &mut session, cancel);
    let _ = session.logout();
    outcome
}

fn failed(message: String) -> Value {
    json!({ "kind": "failed", "message": message })
}

fn watch_inbox(app: &AppHandle, session: &mut Session, cancel: &AtomicBool) -> Option<Value> {
    let deadline = Instant::now() + WAIT_FOR;
    let mut looked_at = HashSet::new();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return None;
        }
        match check_inbox(app, session, &mut looked_at) {
            Ok(Some(payload)) => return Some(payload),
            Ok(None) => {}
            Err(message) => return Some(failed(message)),
        }
        let next = Instant::now() + CHECK_EVERY;
        if next >= deadline {
            return Some(json!({ "kind": "timeout" }));
        }
        while Instant::now() < next {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            thread::sleep(CANCEL_POLL);
        }
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

/// The newest fresh code not handed over yet, newest message first. Each message is downloaded once per wait.
fn check_inbox(app: &AppHandle, session: &mut Session, looked_at: &mut HashSet<u32>) -> Result<Option<Value>, String> {
    let inbox = session.examine("INBOX").map_err(|error| failure("open the inbox", error))?;
    if inbox.exists == 0 {
        return Ok(None);
    }
    let first = inbox.exists.saturating_sub(RECENT_MESSAGES - 1).max(1);
    let now = unix_now();
    let mut fresh: Vec<(i64, u32)> = session
        .fetch(format!("{first}:{}", inbox.exists), "(UID INTERNALDATE RFC822.SIZE)")
        .map_err(|error| failure("list messages", error))?
        .iter()
        .filter_map(|message| Some((message.internal_date()?.timestamp(), message.uid?, message.size?)))
        .filter(|(at, uid, size)| now - at <= FRESH_SECS && *size <= MAX_MESSAGE_BYTES && !looked_at.contains(uid))
        .map(|(at, uid, _)| (at, uid))
        .collect();
    fresh.sort_unstable_by(|a, b| b.cmp(a));
    let state = app.state::<MailCodeState>();
    for (_, uid) in fresh {
        looked_at.insert(uid);
        if lock(&state.delivered).contains(&uid) {
            continue;
        }
        let messages = session
            .uid_fetch(uid.to_string(), "BODY.PEEK[]")
            .map_err(|error| failure("read a message", error))?;
        let Some(reading) = messages.iter().next().and_then(|message| message.body()).and_then(mail_extract::read_message) else {
            continue;
        };
        let payload = match reading.verdict {
            Verdict::NotCode => continue,
            Verdict::Code(code) => {
                let copied = copy(&code);
                json!({ "kind": "found", "code": code, "sender": reading.sender, "copied": copied })
            }
            Verdict::Unrecognized => json!({ "kind": "unrecognized", "sender": reading.sender }),
        };
        lock(&state.delivered).insert(uid);
        return Ok(Some(payload));
    }
    Ok(None)
}

#[cfg(target_os = "macos")]
fn copy(text: &str) -> bool {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    // SAFETY: a constant exported by AppKit.
    let copied = board.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString });
    board.setString_forType(&NSString::from_str(""), &NSString::from_str(CONCEALED_TYPE));
    copied
}

#[cfg(not(target_os = "macos"))]
fn copy(_: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::{BAD_PASSWORD, NOT_163, validate};

    #[test]
    fn takes_only_163_addresses() {
        assert_eq!(validate("someone@163.com", "ABCDEFGHIJKLMNOP"), Ok(()));
        assert_eq!(validate("@163.com", "ABCDEFGHIJKLMNOP"), Err(NOT_163.into()));
        assert_eq!(validate("someone@126.com", "ABCDEFGHIJKLMNOP"), Err(NOT_163.into()));
        assert_eq!(validate("a@b@163.com", "ABCDEFGHIJKLMNOP"), Err(NOT_163.into()));
        assert_eq!(validate("some one@163.com", "ABCDEFGHIJKLMNOP"), Err(NOT_163.into()));
    }

    #[test]
    fn takes_a_plain_authorization_code() {
        assert_eq!(validate("someone@163.com", ""), Err(BAD_PASSWORD.into()));
        assert_eq!(validate("someone@163.com", "授权码"), Err(BAD_PASSWORD.into()));
        assert_eq!(validate("someone@163.com", "ABCD EFGH"), Err(BAD_PASSWORD.into()));
    }
}

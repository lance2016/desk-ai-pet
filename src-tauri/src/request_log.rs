//! What the app's model requests cost and how they went, in the app's database.
//! Every request leaves a short row (`request_stats`: time, model, timing,
//! tokens, no content), kept `STATS_KEEP_DAYS`. Developer mode also keeps whole
//! replies as sent and received (`request_entries`, the newest `MAX_ENTRIES`).
//! The webview writes both (`src/ai/requestLog.ts`). Neither goes into backups.
//! Must match `src/platform/llm.ts`.

use rusqlite::{Connection, params};
use serde::Deserialize;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

use crate::database::Database;

const MAX_ENTRIES: i64 = 100;
const MAX_ENTRY_BYTES: usize = 2 * 1024 * 1024;
const STATS_KEEP_DAYS: i64 = 90;
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const MAX_LABEL_CHARS: usize = 64;

/// One request: what it was for, how long it took, and what it used.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestStat {
    /// Epoch milliseconds the request started at.
    at: i64,
    /// "chat", "web", "text", "greeting" or "test".
    kind: String,
    window: String,
    model: String,
    ok: bool,
    status: Option<u16>,
    duration_ms: i64,
    first_token_ms: Option<i64>,
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    cache_hit_tokens: Option<i64>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_millis() as i64)
}

fn label(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= MAX_LABEL_CHARS && value.chars().all(|char| char.is_ascii_graphic())
}

fn check_stat(stat: &RequestStat) -> Result<(), String> {
    let counts = [Some(stat.duration_ms), stat.first_token_ms, stat.prompt_tokens, stat.completion_tokens, stat.cache_hit_tokens];
    if !label(&stat.kind) || !label(&stat.window) || !label(&stat.model) || counts.iter().flatten().any(|value| *value < 0) {
        return Err("Invalid request record".into());
    }
    Ok(())
}

/// Adds the row and drops rows older than `STATS_KEEP_DAYS` before `now`.
fn add_stat(connection: &Connection, stat: &RequestStat, now: i64) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO request_stats (at, kind, window, model, ok, status, duration_ms, first_token_ms, prompt_tokens, completion_tokens, cache_hit_tokens)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            stat.at, stat.kind, stat.window, stat.model, stat.ok, stat.status, stat.duration_ms,
            stat.first_token_ms, stat.prompt_tokens, stat.completion_tokens, stat.cache_hit_tokens
        ],
    )?;
    connection.execute("DELETE FROM request_stats WHERE at < ?1", params![now - STATS_KEEP_DAYS * DAY_MS])?;
    Ok(())
}

/// Replaces the entry with the same id, or adds it; only the newest `MAX_ENTRIES` stay.
fn put_entry(connection: &Connection, id: &str, at: i64, entry: &str) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO request_entries (id, at, entry) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET entry = excluded.entry",
        params![id, at, entry],
    )?;
    connection.execute(
        "DELETE FROM request_entries WHERE id NOT IN (SELECT id FROM request_entries ORDER BY at DESC, rowid DESC LIMIT ?1)",
        params![MAX_ENTRIES],
    )?;
    Ok(())
}

/// The entries, newest first.
fn entries(connection: &Connection) -> rusqlite::Result<Vec<Value>> {
    let mut statement = connection.prepare("SELECT entry FROM request_entries ORDER BY at DESC, rowid DESC")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows.iter().filter_map(|text| serde_json::from_str(text).ok()).collect())
}

#[tauri::command]
pub fn llm_stats_add(database: tauri::State<'_, Database>, stat: RequestStat) -> Result<(), String> {
    check_stat(&stat)?;
    database.with(|connection| add_stat(connection, &stat, now_ms()))
}

/// A developer-mode entry: `{ id, at, window, rounds }` as the webview builds it.
#[tauri::command]
pub fn llm_log_put(database: tauri::State<'_, Database>, entry: Value) -> Result<(), String> {
    let id = entry.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 128).ok_or("Invalid log entry")?.to_owned();
    let at = entry.get("at").and_then(Value::as_i64).unwrap_or_else(now_ms);
    let text = entry.to_string();
    if text.len() > MAX_ENTRY_BYTES {
        return Err("Log entry too large".into());
    }
    database.with(|connection| put_entry(connection, &id, at, &text))
}

/// Async and off the main thread: the entries can add up to many megabytes.
#[tauri::command]
pub async fn llm_log_list(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Database>().with(|connection| entries(connection)).map(Value::Array)
    })
    .await
    .map_err(|_| "Request log task failed".to_string())?
}

#[tauri::command]
pub fn llm_log_clear(database: tauri::State<'_, Database>) -> Result<(), String> {
    database.with(|connection| connection.execute("DELETE FROM request_entries", []).map(|_| ()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::memory;
    use rusqlite::OptionalExtension;

    fn stat(at: i64) -> RequestStat {
        RequestStat {
            at, kind: "chat".into(), window: "chat".into(), model: "deepseek-chat".into(), ok: true, status: Some(200),
            duration_ms: 1_200, first_token_ms: Some(300), prompt_tokens: Some(900), completion_tokens: Some(40), cache_hit_tokens: Some(640),
        }
    }

    #[test]
    fn keeps_request_rows_for_ninety_days() {
        let connection = memory();
        let now = 100 * DAY_MS;
        add_stat(&connection, &stat(now - 91 * DAY_MS), now - 91 * DAY_MS).unwrap();
        add_stat(&connection, &stat(now - DAY_MS), now).unwrap();
        let ats: Vec<i64> = connection.prepare("SELECT at FROM request_stats").unwrap().query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(ats, vec![now - DAY_MS]);
    }

    #[test]
    fn checks_the_row() {
        assert!(check_stat(&stat(1)).is_ok());
        assert!(check_stat(&RequestStat { model: "".into(), ..stat(1) }).is_err());
        assert!(check_stat(&RequestStat { prompt_tokens: Some(-1), ..stat(1) }).is_err());
        assert!(check_stat(&RequestStat { window: "聊天".into(), ..stat(1) }).is_err());
    }

    #[test]
    fn keeps_the_newest_entries_and_updates_in_place() {
        let connection = memory();
        for index in 0..MAX_ENTRIES + 2 {
            put_entry(&connection, &format!("r{index}"), index, &format!("{{\"id\":\"r{index}\",\"rounds\":[]}}")).unwrap();
        }
        put_entry(&connection, "r101", 101, "{\"id\":\"r101\",\"rounds\":[1]}").unwrap();
        let kept = entries(&connection).unwrap();
        assert_eq!(kept.len() as i64, MAX_ENTRIES);
        assert_eq!(kept[0]["rounds"], serde_json::json!([1]));
        let oldest: Option<String> = connection.query_row("SELECT id FROM request_entries WHERE id = 'r0'", [], |row| row.get(0)).optional().unwrap();
        assert_eq!(oldest, None);
    }
}

//! The work log: what happened each day (reminders, notes, focus rounds), who
//! did it, and what a changed or deleted item said before. Kept in SQLite in
//! the app data folder. The webview only gets these typed commands, never raw
//! SQL. Must match `src/platform/worklog.ts`.
//!
//! Events older than the webview's cut-off are folded into per-day counts
//! (`worklog_compact`), so the file stays small.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

const FILE_NAME: &str = "worklog.sqlite";
/// Each entry moves the schema one version up, in order; `PRAGMA user_version`
/// says how many have run. Never edit one that shipped: add the next.
const MIGRATIONS: &[&str] = &["CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        text TEXT NOT NULL,
        before TEXT,
        item_id TEXT
    );
    CREATE INDEX events_by_day ON events(day);
    CREATE TABLE day_counts (
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (day, kind)
    );"];
const MAX_TEXT_CHARS: usize = 1000;
const MAX_KIND_CHARS: usize = 32;
const MAX_ITEM_ID_CHARS: usize = 64;
/// No real log comes near this; a larger one is not ours.
const MAX_ROWS: usize = 200_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// Epoch milliseconds.
    pub at: i64,
    /// The local day, "YYYY-MM-DD", as the webview saw it.
    pub day: String,
    pub kind: String,
    /// Who did it: "user", or "chat" for a tool in a reply.
    pub source: String,
    pub text: String,
    /// What a changed item said before the change.
    pub before: Option<String>,
    pub item_id: Option<String>,
}

/// How many events of `kind` a day had once its events were folded away.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Count {
    pub day: String,
    pub kind: String,
    pub count: i64,
}

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Log {
    pub events: Vec<Event>,
    pub counts: Vec<Count>,
}

/// The open database; None when it could not be opened.
#[derive(Default)]
pub struct WorkLog(Mutex<Option<Connection>>);

impl WorkLog {
    /// Opens the database in `folder`, creating both when missing.
    pub fn open(folder: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(folder).map_err(|error| format!("Cannot create the data folder: {error}"))?;
        let mut connection = Connection::open(folder.join(FILE_NAME)).map_err(|error| format!("Cannot open the work log: {error}"))?;
        prepare(&mut connection).map_err(|error| format!("Cannot set up the work log: {error}"))?;
        Ok(Self(Mutex::new(Some(connection))))
    }

    fn with<T>(&self, work: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let mut guard = self.0.lock().map_err(|_| "Work log is unavailable".to_string())?;
        let connection = guard.as_mut().ok_or("Work log is unavailable")?;
        work(connection).map_err(|error| format!("Work log error: {error}"))
    }
}

/// Runs the migrations this file has not had yet, each in its own transaction.
fn prepare(connection: &mut Connection) -> rusqlite::Result<()> {
    let done: usize = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (index, migration) in MIGRATIONS.iter().enumerate().skip(done) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration)?;
        transaction.pragma_update(None, "user_version", index + 1)?;
        transaction.commit()?;
    }
    Ok(())
}

fn valid_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| if index == 4 || index == 7 { *byte == b'-' } else { byte.is_ascii_digit() })
}

fn valid_kind(kind: &str) -> bool {
    !kind.is_empty() && kind.len() <= MAX_KIND_CHARS && kind.bytes().all(|byte| byte.is_ascii_lowercase() || byte == b'_')
}

fn check_event(event: &Event) -> Result<(), String> {
    if !valid_day(&event.day) || !valid_kind(&event.kind) || !valid_kind(&event.source) {
        return Err("Invalid work log event".into());
    }
    if event.text.chars().count() > MAX_TEXT_CHARS || event.before.as_ref().is_some_and(|before| before.chars().count() > MAX_TEXT_CHARS) {
        return Err("Work log text is too long".into());
    }
    if event.item_id.as_ref().is_some_and(|id| id.is_empty() || id.chars().count() > MAX_ITEM_ID_CHARS) {
        return Err("Invalid work log item id".into());
    }
    Ok(())
}

fn check_count(count: &Count) -> Result<(), String> {
    if valid_day(&count.day) && valid_kind(&count.kind) && count.count > 0 { Ok(()) } else { Err("Invalid work log count".into()) }
}

fn insert_event(connection: &Connection, event: &Event) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO events (at, day, kind, source, text, before, item_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![event.at, event.day, event.kind, event.source, event.text, event.before, event.item_id],
    )?;
    Ok(())
}

fn add_count(connection: &Connection, count: &Count) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO day_counts (day, kind, count) VALUES (?1, ?2, ?3)
         ON CONFLICT(day, kind) DO UPDATE SET count = count + excluded.count",
        params![count.day, count.kind, count.count],
    )?;
    Ok(())
}

/// Events and counts with `from <= day <= to`, oldest first.
fn read(connection: &Connection, from: &str, to: &str) -> rusqlite::Result<Log> {
    let mut events = connection.prepare("SELECT at, day, kind, source, text, before, item_id FROM events WHERE day >= ?1 AND day <= ?2 ORDER BY at, id")?;
    let events = events
        .query_map(params![from, to], |row| {
            Ok(Event { at: row.get(0)?, day: row.get(1)?, kind: row.get(2)?, source: row.get(3)?, text: row.get(4)?, before: row.get(5)?, item_id: row.get(6)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut counts = connection.prepare("SELECT day, kind, count FROM day_counts WHERE day >= ?1 AND day <= ?2 ORDER BY day, kind")?;
    let counts = counts
        .query_map(params![from, to], |row| Ok(Count { day: row.get(0)?, kind: row.get(1)?, count: row.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Log { events, counts })
}

/// Folds the events of days before `before` into per-day counts.
fn compact(connection: &mut Connection, before: &str) -> rusqlite::Result<()> {
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO day_counts (day, kind, count)
         SELECT day, kind, COUNT(*) FROM events WHERE day < ?1 GROUP BY day, kind
         ON CONFLICT(day, kind) DO UPDATE SET count = count + excluded.count",
        params![before],
    )?;
    transaction.execute("DELETE FROM events WHERE day < ?1", params![before])?;
    transaction.commit()
}

/// Makes the log hold exactly `log`; nothing changes when a row fails.
fn replace(connection: &mut Connection, log: &Log) -> rusqlite::Result<()> {
    let transaction = connection.transaction()?;
    transaction.execute_batch("DELETE FROM events; DELETE FROM day_counts;")?;
    for event in &log.events {
        insert_event(&transaction, event)?;
    }
    for count in &log.counts {
        add_count(&transaction, count)?;
    }
    transaction.commit()
}

#[tauri::command]
pub fn worklog_append(state: tauri::State<'_, WorkLog>, event: Event) -> Result<(), String> {
    check_event(&event)?;
    state.with(|connection| insert_event(connection, &event))
}

#[tauri::command]
pub fn worklog_read(state: tauri::State<'_, WorkLog>, from: String, to: String) -> Result<Log, String> {
    if !valid_day(&from) || !valid_day(&to) {
        return Err("Invalid day".into());
    }
    state.with(|connection| read(connection, &from, &to))
}

#[tauri::command]
pub fn worklog_compact(state: tauri::State<'_, WorkLog>, before: String) -> Result<(), String> {
    if !valid_day(&before) {
        return Err("Invalid day".into());
    }
    state.with(|connection| compact(connection, &before))
}

/// Adds to the counts of whole days, as when older records are brought in.
#[tauri::command]
pub fn worklog_add_counts(state: tauri::State<'_, WorkLog>, counts: Vec<Count>) -> Result<(), String> {
    counts.iter().try_for_each(check_count)?;
    state.with(|connection| {
        let transaction = connection.transaction()?;
        for count in &counts {
            add_count(&transaction, count)?;
        }
        transaction.commit()
    })
}

#[tauri::command]
pub fn worklog_export(state: tauri::State<'_, WorkLog>) -> Result<Log, String> {
    state.with(|connection| read(connection, "0000-00-00", "9999-99-99"))
}

/// Restoring a backup: the whole log is replaced.
#[tauri::command]
pub fn worklog_replace(state: tauri::State<'_, WorkLog>, log: Log) -> Result<(), String> {
    if log.events.len() + log.counts.len() > MAX_ROWS {
        return Err("Work log is too large".into());
    }
    log.events.iter().try_for_each(check_event)?;
    log.counts.iter().try_for_each(check_count)?;
    state.with(|connection| replace(connection, &log))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        prepare(&mut connection).unwrap();
        connection
    }

    fn event(at: i64, day: &str, kind: &str) -> Event {
        Event { at, day: day.into(), kind: kind.into(), source: "user".into(), text: "开会".into(), before: None, item_id: Some("a".into()) }
    }

    #[test]
    fn reads_a_range_of_days_in_order() {
        let connection = memory();
        for item in [event(3, "2026-11-19", "reminder_done"), event(1, "2026-11-18", "note_added"), event(2, "2026-11-17", "focus_completed")] {
            insert_event(&connection, &item).unwrap();
        }
        let log = read(&connection, "2026-11-18", "2026-11-19").unwrap();
        assert_eq!(log.events.iter().map(|item| item.at).collect::<Vec<_>>(), vec![1, 3]);
    }

    #[test]
    fn compacting_folds_old_days_into_counts() {
        let mut connection = memory();
        add_count(&connection, &Count { day: "2026-10-01".into(), kind: "focus_completed".into(), count: 2 }).unwrap();
        for item in [event(1, "2026-10-01", "focus_completed"), event(2, "2026-10-01", "focus_completed"), event(3, "2026-11-19", "focus_completed")] {
            insert_event(&connection, &item).unwrap();
        }
        compact(&mut connection, "2026-10-20").unwrap();
        let log = read(&connection, "0000-00-00", "9999-99-99").unwrap();
        assert_eq!(log.events.len(), 1);
        assert_eq!(log.counts, vec![Count { day: "2026-10-01".into(), kind: "focus_completed".into(), count: 4 }]);
    }

    #[test]
    fn replacing_swaps_the_whole_log() {
        let mut connection = memory();
        insert_event(&connection, &event(1, "2026-11-18", "note_added")).unwrap();
        let backup = Log { events: vec![event(9, "2026-11-01", "reminder_added")], counts: vec![Count { day: "2026-09-01".into(), kind: "reminder_done".into(), count: 3 }] };
        replace(&mut connection, &backup).unwrap();
        assert_eq!(read(&connection, "0000-00-00", "9999-99-99").unwrap(), backup);
    }

    #[test]
    fn preparing_again_runs_no_migration_twice() {
        let mut connection = memory();
        let changed = Event { kind: "note_edited".into(), source: "chat".into(), before: Some("旧的".into()), ..event(1, "2026-11-18", "note_edited") };
        insert_event(&connection, &changed).unwrap();
        prepare(&mut connection).unwrap();
        let version: usize = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len());
        assert_eq!(read(&connection, "2026-11-18", "2026-11-18").unwrap().events, vec![changed]);
    }

    #[test]
    fn rejects_malformed_input() {
        assert!(check_event(&event(1, "2026-1-18", "note_added")).is_err());
        assert!(check_event(&event(1, "2026-11-18", "Note Added")).is_err());
        assert!(check_event(&Event { source: "".into(), ..event(1, "2026-11-18", "note_added") }).is_err());
        assert!(check_event(&Event { before: Some("长".repeat(MAX_TEXT_CHARS + 1)), ..event(1, "2026-11-18", "note_added") }).is_err());
        assert!(check_event(&Event { text: "长".repeat(MAX_TEXT_CHARS + 1), ..event(1, "2026-11-18", "note_added") }).is_err());
        assert!(check_event(&event(1, "2026-11-18", "note_added")).is_ok());
        assert!(check_count(&Count { day: "2026-11-18".into(), kind: "focus_completed".into(), count: 0 }).is_err());
    }
}

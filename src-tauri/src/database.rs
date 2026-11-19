//! The app's SQLite database in the app data folder: the work log (`worklog.rs`)
//! and the request records (`request_log.rs`). The webview never sends SQL; each
//! module offers typed commands. The schema only moves forward through `MIGRATIONS`.

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

/// Named for the work log, the first thing kept here; renaming it would lose the user's data.
const FILE_NAME: &str = "worklog.sqlite";
/// Each entry moves the schema one version up, in order; `PRAGMA user_version`
/// says how many have run. Never edit one that shipped: add the next.
pub(crate) const MIGRATIONS: &[&str] = &[
    "CREATE TABLE events (
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
    );",
    "CREATE TABLE request_stats (
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        window TEXT NOT NULL,
        model TEXT NOT NULL,
        ok INTEGER NOT NULL,
        status INTEGER,
        duration_ms INTEGER NOT NULL,
        first_token_ms INTEGER,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cache_hit_tokens INTEGER
    );
    CREATE INDEX request_stats_by_at ON request_stats(at);
    CREATE TABLE request_entries (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        entry TEXT NOT NULL
    );",
];

/// The open database; None when it could not be opened.
#[derive(Default)]
pub struct Database(Mutex<Option<Connection>>);

impl Database {
    /// Opens the database in `folder`, creating both when missing.
    pub fn open(folder: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(folder).map_err(|error| format!("Cannot create the data folder: {error}"))?;
        let mut connection = Connection::open(folder.join(FILE_NAME)).map_err(|error| format!("Cannot open the database: {error}"))?;
        prepare(&mut connection).map_err(|error| format!("Cannot set up the database: {error}"))?;
        Ok(Self(Mutex::new(Some(connection))))
    }

    pub(crate) fn with<T>(&self, work: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let mut guard = self.0.lock().map_err(|_| "Database is unavailable".to_string())?;
        let connection = guard.as_mut().ok_or("Database is unavailable")?;
        work(connection).map_err(|error| format!("Database error: {error}"))
    }
}

/// Runs the migrations this file has not had yet, each in its own transaction.
pub(crate) fn prepare(connection: &mut Connection) -> rusqlite::Result<()> {
    let done: usize = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (index, migration) in MIGRATIONS.iter().enumerate().skip(done) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration)?;
        transaction.pragma_update(None, "user_version", index + 1)?;
        transaction.commit()?;
    }
    Ok(())
}

/// A fresh database in memory, for tests.
#[cfg(test)]
pub(crate) fn memory() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    prepare(&mut connection).unwrap();
    connection
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_each_migration_once_and_keeps_the_data() {
        let mut connection = memory();
        connection.execute("INSERT INTO day_counts (day, kind, count) VALUES ('2026-11-18', 'note_added', 1)", []).unwrap();
        prepare(&mut connection).unwrap();
        let version: usize = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len());
        let kept: i64 = connection.query_row("SELECT count FROM day_counts", [], |row| row.get(0)).unwrap();
        assert_eq!(kept, 1);
    }

    #[test]
    fn brings_a_version_one_file_up_to_date() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(MIGRATIONS[0]).unwrap();
        connection.pragma_update(None, "user_version", 1).unwrap();
        prepare(&mut connection).unwrap();
        let tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'request_%'", [], |row| row.get(0)).unwrap();
        assert_eq!(tables, 2);
    }
}

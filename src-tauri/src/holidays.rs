//! Downloads one year of China's official holiday schedule (the `chinese-days`
//! package's data), so working-day reminders stay right after the bundled data
//! runs out. Must match `src/platform/holidays.ts`.

use std::process::Command;

/// The npm mirror in China first, then a global CDN. Both serve the latest package.
const SOURCES: [&str; 2] = [
    "https://registry.npmmirror.com/chinese-days/latest/files/dist/years/",
    "https://cdn.jsdelivr.net/npm/chinese-days/dist/years/",
];
/// A year file is under 2 KB; anything far larger is not one.
const MAX_BYTES: &str = "65536";
const YEARS: std::ops::RangeInclusive<u32> = 2000..=2100;

/// What one source said about a year.
#[derive(Debug, PartialEq)]
enum Answer {
    Found(String),
    NotPublished,
    Failed,
}

/// Reads curl's output: the body, then the status code on the last line.
fn read_answer(output: &[u8]) -> Answer {
    let Ok(text) = std::str::from_utf8(output) else {
        return Answer::Failed;
    };
    match text.rsplit_once('\n') {
        Some((body, "200")) => Answer::Found(body.to_owned()),
        Some((_, "404")) => Answer::NotPublished,
        _ => Answer::Failed,
    }
}

fn ask(url: &str) -> Answer {
    let output = Command::new("/usr/bin/curl")
        .args([
            "--disable", "--silent", "--location", "--max-time", "15", "--max-filesize", MAX_BYTES,
            "--proto", "=https", "--proto-redir", "=https", "--write-out", "\n%{http_code}", url,
        ])
        .args(crate::proxy::curl_args())
        .output();
    match output {
        Ok(output) if output.status.success() => read_answer(&output.stdout),
        _ => Answer::Failed,
    }
}

/// The year's schedule as JSON, or None when it is not published yet.
#[tauri::command]
pub async fn fetch_holiday_year(year: u32) -> Result<Option<String>, String> {
    if !YEARS.contains(&year) {
        return Err("Invalid year".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        for source in SOURCES {
            match ask(&format!("{source}{year}.json")) {
                Answer::Found(body) => return Ok(Some(body)),
                Answer::NotPublished => return Ok(None),
                Answer::Failed => continue,
            }
        }
        Err("Cannot download holiday data".to_string())
    })
    .await
    .map_err(|_| "Holiday download task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{Answer, read_answer};

    #[test]
    fn reads_the_body_and_the_status() {
        assert_eq!(read_answer(b"{\"holidays\":{}}\n200"), Answer::Found("{\"holidays\":{}}".into()));
        assert_eq!(read_answer(b"Not Found\n404"), Answer::NotPublished);
        assert_eq!(read_answer(b"\n502"), Answer::Failed);
        assert_eq!(read_answer(b"no status"), Answer::Failed);
    }
}

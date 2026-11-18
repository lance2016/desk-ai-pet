use serde_json::{Value, json};

pub(super) const READ_TOOL: &str = "deepseek_read_url";
pub(super) const SEARCH_TOOL: &str = "deepseek_web_search";
const MAX_CONTEXT_BYTES: usize = 512 * 1024;
const MAX_SOURCES: usize = 20;
const MAX_URL_BYTES: usize = 2048;
const MAX_TITLE_CHARS: usize = 256;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Mode {
    Open,
    Follow,
    Search,
    Image,
}

impl Mode {
    pub(super) fn parse(value: Option<&str>, window: &str) -> Result<Option<Self>, String> {
        match (value, window) {
            (None, _) => Ok(None),
            (Some("open"), crate::CHAT_WINDOW) => Ok(Some(Self::Open)),
            (Some("follow"), crate::CHAT_WINDOW) => Ok(Some(Self::Follow)),
            (Some("search"), crate::CHAT_WINDOW) => Ok(Some(Self::Search)),
            (Some("image"), crate::CHAT_WINDOW) => Ok(Some(Self::Image)),
            _ => Err("Invalid link reading mode".into()),
        }
    }

    pub(super) fn tools(self) -> Option<Value> {
        match self {
            Self::Open => Some(json!([{ "type": READ_TOOL }])),
            Self::Search => Some(json!([{ "type": SEARCH_TOOL }])),
            Self::Follow | Self::Image => None,
        }
    }
}

#[derive(Debug, Default, PartialEq)]
pub(super) struct Delta {
    pub event: Option<Value>,
    pub calls: Option<Value>,
    pub annotations: Option<Value>,
}

impl Delta {
    pub(super) fn from_choice(choice: &Value) -> Self {
        let mut delta = Self {
            event: choice.get("server_tool_event").cloned(),
            ..Self::default()
        };
        if choice["finish_reason"].is_string() {
            delta.calls = choice
                .pointer("/delta/server_tool_calls")
                .filter(|value| value.is_array())
                .cloned();
            delta.annotations = choice
                .pointer("/delta/annotations")
                .filter(|value| value.is_array())
                .cloned();
        }
        delta
    }
}

#[derive(Default)]
pub(super) struct ResultData {
    calls: Option<Value>,
    annotations: Option<Value>,
}

fn successful_read(call: &Value) -> bool {
    call["type"] == READ_TOOL && call["status"] == "completed"
}

fn calls(steps: &Value) -> impl Iterator<Item = &Value> {
    steps
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|step| step["calls"].as_array().into_iter().flatten())
}

/// Restore the provider's opaque state without rebuilding or trimming its tool calls.
pub(super) fn restore_calls(message: &Value) -> Option<Value> {
    let saved = message.pointer("/web/calls")?.as_str()?;
    if saved.len() > MAX_CONTEXT_BYTES {
        return None;
    }
    let calls = serde_json::from_str::<Value>(saved).ok()?;
    has_snapshot(&calls).then_some(calls)
}

fn has_snapshot(calls: &Value) -> bool {
    self::calls(calls).any(|call| {
        successful_read(call)
            && call["signature"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
    })
}

impl ResultData {
    pub(super) fn update(&mut self, delta: Delta) -> Option<&'static str> {
        if delta.calls.is_some() {
            self.calls = delta.calls;
        }
        if delta.annotations.is_some() {
            self.annotations = delta.annotations;
        }
        let event = delta.event?;
        let call = &event["call"];
        if call["type"] == SEARCH_TOOL {
            return match event["type"].as_str()? {
                "call_started" => Some("searching"),
                "call_completed" if call["status"] == "completed" => Some("searched"),
                "call_completed" => Some("search-failed"),
                _ => None,
            };
        }
        if call["type"] != READ_TOOL {
            return None;
        }
        match event["type"].as_str()? {
            "call_started" => Some("reading"),
            "call_completed" if successful_read(call) => Some("read"),
            "call_completed" => Some("failed"),
            _ => None,
        }
    }

    pub(super) fn read_page(&self) -> bool {
        self.calls
            .as_ref()
            .is_some_and(|steps| calls(steps).any(successful_read))
    }

    pub(super) fn found_sources(&self) -> bool {
        self.calls.as_ref().is_some_and(|steps| {
            calls(steps).any(|call| {
                call["type"] == SEARCH_TOOL
                    && call["status"] == "completed"
                    && call["sources"].as_array().is_some_and(|sources| {
                        sources.iter().any(|source| source["url"].is_string())
                    })
            })
        })
    }

    pub(super) fn payload(&self, truncated: bool) -> Value {
        let mut sources: Vec<Value> = Vec::new();
        let mut add_source = |entry: &Value| {
            let Some(url) = entry["url"].as_str() else {
                return;
            };
            if url.len() > MAX_URL_BYTES
                || !(url.starts_with("https://") || url.starts_with("http://"))
                || url.chars().any(|c| c.is_control() || c.is_whitespace())
                || sources.len() >= MAX_SOURCES
                || sources.iter().any(|source| source["url"] == url)
            {
                return;
            }
            let title = entry["title"]
                .as_str()
                .unwrap_or("")
                .trim()
                .chars()
                .take(MAX_TITLE_CHARS)
                .collect::<String>();
            sources.push(json!({ "url": url, "title": title }));
        };
        for citation in self
            .annotations
            .iter()
            .filter_map(Value::as_array)
            .flatten()
        {
            if citation["type"] == "url_citation" {
                add_source(&citation["url_citation"]);
            }
        }
        let mut incomplete = false;
        let mut snapshot = None;
        if let Some(steps) = &self.calls {
            for call in calls(steps) {
                if successful_read(call) {
                    add_source(&call["page"]);
                } else if call["type"] == SEARCH_TOOL && call["status"] == "completed" {
                    for source in call["sources"].as_array().into_iter().flatten() {
                        if source["type"] == "url" {
                            add_source(source);
                        }
                    }
                } else if call["type"] == READ_TOOL || call["type"] == SEARCH_TOOL {
                    incomplete = true;
                }
            }
            if has_snapshot(steps) {
                let serialized = steps.to_string();
                if serialized.len() <= MAX_CONTEXT_BYTES {
                    snapshot = Some(serialized);
                }
            }
        }
        let mut payload =
            json!({ "sources": sources, "incomplete": incomplete, "truncated": truncated });
        if let Some(snapshot) = snapshot {
            payload["calls"] = json!(snapshot);
        }
        payload
    }
}

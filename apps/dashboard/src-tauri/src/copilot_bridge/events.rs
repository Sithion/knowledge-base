//! Typed transcript events emitted to the Tauri frontend.
//!
//! `TranscriptEvent` mirrors the structure described in
//! `specs/copilot-cli-bridge/spec.md` (Requirement: JSONL event streaming
//! and parsing). The parser is intentionally tolerant: anything that does
//! not match a known shape becomes [`TranscriptEvent::Unknown`] so the UI
//! can still render it without crashing the bridge.

use serde::{Deserialize, Serialize};

/// Categorised kinds of error events.
///
/// The bridge maps stderr regex hits to one of these so the UI can render
/// targeted remediation guidance ("Run `copilot login` and retry", etc.).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    AuthFailure,
    NetworkUnreachable,
    ModelNotFound,
    AgentNotFound,
    ParseFailure,
    OtherStderr,
}

/// Tagged transcript event. Serializes as
/// `{ "type": "<snake>", ...payload }` for ergonomic JS-side dispatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TranscriptEvent {
    ToolCall {
        tool: String,
        args: serde_json::Value,
    },
    ToolResult {
        tool: String,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
    },
    TextDelta {
        content: String,
    },
    FinalMessage {
        content: String,
    },
    Error {
        kind: ErrorKind,
        message: String,
    },
    Unknown {
        raw: String,
    },
}

/// Wrapper payload for the `agent-transcript-event` Tauri event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEventPayload {
    pub session_id: String,
    pub phase: String,
    #[serde(flatten)]
    pub event: TranscriptEvent,
}

/// Best-effort tolerant parser for a single Copilot CLI stdout JSONL line.
///
/// Copilot CLI's JSONL schema is **not stable** across versions, so this
/// function inspects a small set of plausible field names and falls back
/// to [`TranscriptEvent::Unknown`] whenever it can't be sure. It will
/// never panic and never returns a parse error — invalid JSON yields an
/// `Unknown { raw }` carrying the original line.
pub fn parse_jsonl_line(line: &str) -> TranscriptEvent {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return TranscriptEvent::Unknown {
            raw: String::new(),
        };
    }

    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            return TranscriptEvent::Unknown {
                raw: trimmed.to_string(),
            }
        }
    };

    let event_type = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match event_type.as_str() {
        "tool_call" | "tool-call" | "toolcall" | "tool_use" => {
            let tool = value
                .get("tool")
                .or_else(|| value.get("name"))
                .or_else(|| value.get("tool_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let args = value
                .get("args")
                .or_else(|| value.get("input"))
                .or_else(|| value.get("parameters"))
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            TranscriptEvent::ToolCall { tool, args }
        }
        "tool_result" | "tool-result" | "toolresult" => {
            let tool = value
                .get("tool")
                .or_else(|| value.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let ok = value
                .get("ok")
                .and_then(|v| v.as_bool())
                .or_else(|| {
                    value
                        .get("success")
                        .and_then(|v| v.as_bool())
                })
                .or_else(|| {
                    // Heuristic: presence of `error` field implies failure.
                    value.get("error").map(|_| false)
                })
                .unwrap_or(true);
            let summary = value
                .get("summary")
                .or_else(|| value.get("output"))
                .or_else(|| value.get("result"))
                .and_then(|v| match v {
                    serde_json::Value::String(s) => Some(s.clone()),
                    other => Some(other.to_string()),
                });
            TranscriptEvent::ToolResult { tool, ok, summary }
        }
        "text_delta" | "text-delta" | "delta" | "token" => {
            let content = value
                .get("content")
                .or_else(|| value.get("text"))
                .or_else(|| value.get("delta"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            TranscriptEvent::TextDelta { content }
        }
        "final_message" | "final-message" | "message" | "assistant_message" => {
            let content = value
                .get("content")
                .or_else(|| value.get("text"))
                .or_else(|| value.get("message"))
                .and_then(|v| match v {
                    serde_json::Value::String(s) => Some(s.clone()),
                    other => Some(other.to_string()),
                })
                .unwrap_or_default();
            TranscriptEvent::FinalMessage { content }
        }
        "error" => {
            let message = value
                .get("message")
                .or_else(|| value.get("error"))
                .and_then(|v| match v {
                    serde_json::Value::String(s) => Some(s.clone()),
                    other => Some(other.to_string()),
                })
                .unwrap_or_else(|| trimmed.to_string());
            TranscriptEvent::Error {
                kind: ErrorKind::OtherStderr,
                message,
            }
        }
        _ => TranscriptEvent::Unknown {
            raw: trimmed.to_string(),
        },
    }
}

/// Inspect a stderr line for the spec-defined error patterns. Returns
/// `Some(ErrorKind)` if a pattern matches, otherwise `None`.
pub fn classify_stderr_line(line: &str) -> Option<ErrorKind> {
    let lower = line.to_ascii_lowercase();
    if lower.contains("401")
        || lower.contains("unauthorized")
        || (lower.contains("not") && lower.contains("authenticated"))
    {
        return Some(ErrorKind::AuthFailure);
    }
    if lower.contains("enotfound")
        || lower.contains("getaddrinfo")
        || lower.contains("econnrefused")
    {
        return Some(ErrorKind::NetworkUnreachable);
    }
    if lower.contains("model") && lower.contains("not found") {
        return Some(ErrorKind::ModelNotFound);
    }
    if lower.contains("agent") && lower.contains("not found") {
        return Some(ErrorKind::AgentNotFound);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_json_yields_unknown() {
        match parse_jsonl_line("not json at all") {
            TranscriptEvent::Unknown { raw } => assert_eq!(raw, "not json at all"),
            other => panic!("expected Unknown, got {:?}", other),
        }
    }

    #[test]
    fn empty_line_yields_unknown_empty() {
        match parse_jsonl_line("   ") {
            TranscriptEvent::Unknown { raw } => assert_eq!(raw, ""),
            other => panic!("expected Unknown, got {:?}", other),
        }
    }

    #[test]
    fn tool_call_parsed() {
        let line = r#"{"type":"tool_call","tool":"read_file","args":{"path":"/tmp/x"}}"#;
        match parse_jsonl_line(line) {
            TranscriptEvent::ToolCall { tool, args } => {
                assert_eq!(tool, "read_file");
                assert_eq!(args["path"], "/tmp/x");
            }
            other => panic!("expected ToolCall, got {:?}", other),
        }
    }

    #[test]
    fn tool_result_with_error_field_marks_not_ok() {
        let line = r#"{"type":"tool_result","tool":"x","error":"boom"}"#;
        match parse_jsonl_line(line) {
            TranscriptEvent::ToolResult { ok, .. } => assert!(!ok),
            other => panic!("expected ToolResult, got {:?}", other),
        }
    }

    #[test]
    fn text_delta_alt_keys() {
        let line = r#"{"type":"delta","text":"hello"}"#;
        match parse_jsonl_line(line) {
            TranscriptEvent::TextDelta { content } => assert_eq!(content, "hello"),
            other => panic!("expected TextDelta, got {:?}", other),
        }
    }

    #[test]
    fn future_event_type_degrades_to_unknown() {
        let line = r#"{"type":"some_future_thing","foo":1}"#;
        match parse_jsonl_line(line) {
            TranscriptEvent::Unknown { raw } => assert!(raw.contains("some_future_thing")),
            other => panic!("expected Unknown, got {:?}", other),
        }
    }

    #[test]
    fn stderr_auth_classifier() {
        assert_eq!(
            classify_stderr_line("HTTP 401 Unauthorized from upstream"),
            Some(ErrorKind::AuthFailure)
        );
        assert_eq!(
            classify_stderr_line("user is not authenticated"),
            Some(ErrorKind::AuthFailure)
        );
    }

    #[test]
    fn stderr_network_classifier() {
        assert_eq!(
            classify_stderr_line("getaddrinfo ENOTFOUND api.githubcopilot.com"),
            Some(ErrorKind::NetworkUnreachable)
        );
        assert_eq!(
            classify_stderr_line("connect ECONNREFUSED 127.0.0.1:443"),
            Some(ErrorKind::NetworkUnreachable)
        );
    }

    #[test]
    fn stderr_model_agent_classifier() {
        assert_eq!(
            classify_stderr_line("model gpt-9 not found"),
            Some(ErrorKind::ModelNotFound)
        );
        assert_eq!(
            classify_stderr_line("agent mojito:second-brain not found"),
            Some(ErrorKind::AgentNotFound)
        );
    }

    #[test]
    fn stderr_benign_line_no_classification() {
        assert_eq!(classify_stderr_line("starting up"), None);
    }
}

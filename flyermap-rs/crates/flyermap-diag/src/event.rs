use crate::{level::Level, redact};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A field value. Text has been redacted by the time it is here.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Value {
    Int(i64),
    Float(f64),
    Bool(bool),
    Text(String),
}

impl From<i64> for Value {
    fn from(v: i64) -> Value {
        Value::Int(v)
    }
}
impl From<i32> for Value {
    fn from(v: i32) -> Value {
        Value::Int(i64::from(v))
    }
}
impl From<u64> for Value {
    fn from(v: u64) -> Value {
        Value::Int(i64::try_from(v).unwrap_or(i64::MAX))
    }
}
impl From<usize> for Value {
    fn from(v: usize) -> Value {
        Value::Int(i64::try_from(v).unwrap_or(i64::MAX))
    }
}
impl From<u32> for Value {
    fn from(v: u32) -> Value {
        Value::Int(i64::from(v))
    }
}
impl From<f64> for Value {
    fn from(v: f64) -> Value {
        Value::Float(v)
    }
}
impl From<bool> for Value {
    fn from(v: bool) -> Value {
        Value::Bool(v)
    }
}
impl From<&str> for Value {
    fn from(v: &str) -> Value {
        Value::Text(redact::redact_text(v, redact::MAX_TEXT))
    }
}
impl From<String> for Value {
    fn from(v: String) -> Value {
        Value::from(v.as_str())
    }
}

/// One thing that happened.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// Milliseconds since the epoch.
    pub t: u64,
    pub level: Level,
    /// Where: `sync`, `store`, `map`, `engine`, `net`, `boot`, ...
    pub area: String,
    /// A stable code for failures a person can meet (`sync.push.forbidden`); see `flyermap-wire::text` for the sentence that goes with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub message: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<String, Value>,
}

impl Event {
    /// Builds an event. Message and text fields are redacted; fields under a secret-looking key (position, token, name, ...) never keep their value.
    pub fn new(t: u64, level: Level, area: &str, code: Option<&str>, message: &str, fields: &[(&str, Value)]) -> Event {
        let fields = fields
            .iter()
            .take(redact::MAX_KEYS)
            .map(|(key, value)| {
                let value = if redact::is_secret_key(key) { Value::Text("[removed]".into()) } else { value.clone() };
                ((*key).to_string(), value)
            })
            .collect();
        Event { t, level, area: area.to_string(), code: code.map(str::to_string), message: redact::redact_text(message, redact::MAX_TEXT), fields }
    }
}

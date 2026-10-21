use crate::level::Level;
use serde::{Deserialize, Serialize};

/// Something the app found wrong with itself (a broken invariant, a stuck queue, a clock far off): a stable code and a sentence for support.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Finding {
    pub level: Level,
    pub code: String,
    pub detail: String,
}

impl Finding {
    pub fn new(level: Level, code: &str, detail: &str) -> Finding {
        Finding { level, code: code.to_string(), detail: crate::redact::redact_text(detail, 200) }
    }
}

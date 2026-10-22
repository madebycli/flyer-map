/// What can go wrong with an engine call. The person sees a sentence chosen by the caller; these are for the diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum EngineError {
    #[error("the engine worker is not available")]
    Unavailable,
    #[error("the engine worker answered: {0}")]
    Worker(String),
    /// The engine refused (its own code, e.g. `pack_invalid`; the text after the code is dropped, it may quote data).
    #[error("the engine refused: {0}")]
    Refused(String),
    #[error("the engine's answer could not be read")]
    BadAnswer,
}

impl EngineError {
    /// The engine writes `{"error":"code: details"}`; only the code is kept.
    pub fn refused(json: &[u8]) -> EngineError {
        let text = serde_json::from_slice::<serde_json::Value>(json).ok().and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string));
        let code = text.as_deref().and_then(|t| t.split(':').next()).unwrap_or("unknown").trim();
        let code: String = code.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(40).collect();
        EngineError::Refused(code)
    }

    pub fn code(&self) -> &str {
        match self {
            EngineError::Unavailable => "engine_unavailable",
            EngineError::Worker(code) | EngineError::Refused(code) => code,
            EngineError::BadAnswer => "engine_bad_answer",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_code_of_a_refusal_is_kept() {
        let e = EngineError::refused(br#"{"error":"pack_invalid: expected value at line 1 column 1"}"#);
        assert_eq!(e, EngineError::Refused("pack_invalid".into()));
        assert_eq!(EngineError::refused(b"garbage").code(), "unknown");
    }
}

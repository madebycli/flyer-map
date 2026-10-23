//! A failed request to our own server, reduced to what the app needs: the status, a stable code for the diagnostics and a German sentence for the
//! person. The sentence comes from our server (`flyermap-wire::error`), never from a third party; without one a neutral sentence is used.

/// `status` 0 means the request never got an answer (offline, connection lost, blocked).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpError {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl HttpError {
    pub fn network() -> HttpError {
        HttpError { status: 0, code: "network".into(), message: "Keine Verbindung zum Server.".into() }
    }

    /// The answer could not be read as what was asked for.
    pub fn bad_answer() -> HttpError {
        HttpError { status: 0, code: "bad_answer".into(), message: "Antwort des Servers unlesbar.".into() }
    }

    /// `403 cross_origin`: what the diagnostics keep (it survives redaction).
    pub fn diag_code(&self) -> String {
        format!("{} {}", self.status, self.code)
    }

    /// The error of a non-2xx answer from its status and body. Only a well-formed code is taken over.
    pub fn from_answer(status: u16, body: &str) -> HttpError {
        let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
        let error = parsed.as_ref().and_then(|v| v.get("error"));
        let code = error.and_then(|e| e.get("code")).and_then(|c| c.as_str()).filter(|c| is_code(c)).map(str::to_string);
        let message = error.and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(|m| m.chars().take(200).collect::<String>());
        HttpError { status, code: code.unwrap_or_else(|| format!("http_{status}")), message: message.unwrap_or_else(|| format!("Serverfehler {status}")) }
    }
}

fn is_code(text: &str) -> bool {
    let mut chars = text.chars();
    (2..=41).contains(&text.len())
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_server_code_and_sentence_are_taken_over() {
        let e = HttpError::from_answer(403, r#"{"error":{"code":"area_forbidden","message":"In diesem Gebiet darfst du das nicht."}}"#);
        assert_eq!((e.status, e.code.as_str(), e.message.as_str()), (403, "area_forbidden", "In diesem Gebiet darfst du das nicht."));
        assert_eq!(e.diag_code(), "403 area_forbidden");
    }

    #[test]
    fn a_body_that_is_not_ours_gives_a_neutral_error() {
        let e = HttpError::from_answer(502, "<html>bad gateway</html>");
        assert_eq!((e.code.as_str(), e.message.as_str()), ("http_502", "Serverfehler 502"));
        let e = HttpError::from_answer(500, r#"{"error":{"code":"DROP TABLE; --","message":"x"}}"#);
        assert_eq!(e.code, "http_500", "a code that is not one of ours is not copied");
    }
}

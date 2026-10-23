//! What can go wrong between the interface and a server, in the words a person reads. The codes are the server's stable ones (or ours for the
//! mock); the sentences are German and live here, in one place.
use crate::platform::HttpError;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum BackendError {
    /// No (valid) session: the device has to join or sign in.
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("not found")]
    NotFound,
    /// The server could not be reached or answered with an error.
    #[error("unavailable: {code}")]
    Unavailable { code: String, message: String },
    /// This backend cannot do that (yet): the feature shows a note instead of a button that fails.
    #[error("unsupported: {0}")]
    Unsupported(&'static str),
    /// The request was refused as wrong (a code that does not exist, a Gebiet that overlaps another).
    #[error("invalid: {code}")]
    Invalid { code: String, message: String },
}

impl BackendError {
    /// The sentence for the person.
    pub fn message(&self) -> String {
        match self {
            BackendError::Unauthorized => "Du bist hier nicht angemeldet.".into(),
            BackendError::Forbidden(m) if !m.is_empty() => m.clone(),
            BackendError::Forbidden(_) => "Das darfst du hier nicht.".into(),
            BackendError::NotFound => "Das gibt es nicht (mehr).".into(),
            BackendError::Unavailable { message, .. } | BackendError::Invalid { message, .. } => message.clone(),
            BackendError::Unsupported(what) => format!("„{what}“ geht mit diesem Server noch nicht."),
        }
    }

    /// A stable code for the diagnostics.
    pub fn code(&self) -> String {
        match self {
            BackendError::Unauthorized => "unauthorized".into(),
            BackendError::Forbidden(_) => "forbidden".into(),
            BackendError::NotFound => "not_found".into(),
            BackendError::Unavailable { code, .. } | BackendError::Invalid { code, .. } => code.clone(),
            BackendError::Unsupported(_) => "unsupported".into(),
        }
    }
}

impl From<HttpError> for BackendError {
    fn from(e: HttpError) -> BackendError {
        match e.status {
            401 => BackendError::Unauthorized,
            403 => BackendError::Forbidden(e.message),
            404 => BackendError::NotFound,
            400 | 409 | 422 => BackendError::Invalid { code: e.code, message: e.message },
            _ => BackendError::Unavailable { code: e.code, message: e.message },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_statuses_become_the_errors_the_screens_know() {
        assert_eq!(BackendError::from(HttpError::from_answer(401, "")), BackendError::Unauthorized);
        assert_eq!(BackendError::from(HttpError::from_answer(404, "")), BackendError::NotFound);
        assert!(matches!(BackendError::from(HttpError::from_answer(503, "")), BackendError::Unavailable { .. }));
        assert_eq!(BackendError::from(HttpError::network()).code(), "network");
        assert_eq!(BackendError::Unsupported("Personen").message(), "„Personen“ geht mit diesem Server noch nicht.");
    }
}

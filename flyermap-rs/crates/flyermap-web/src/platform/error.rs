/// What can go wrong when the app talks to the browser. These are for developers and the diagnosis report, not for people: a person never reads
/// them (every caller has a quiet fallback), so they carry no German text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PlatformError {
    #[error("there is no window or document (not running in a browser)")]
    NoWindow,
    #[error("local storage is not available (private mode or blocked site data)")]
    StorageUnavailable,
    #[error("local storage refused the write (quota or blocked)")]
    StorageWrite,
    #[error("the browser has no {0}")]
    Unsupported(&'static str),
    #[error("the browser refused: {0}")]
    Refused(&'static str),
}

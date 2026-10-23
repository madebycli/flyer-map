//! Failures of a request, as the API names them: a stable code for machines, a short English detail for people reading logs. The app translates
//! the code into texts for users.
use flyermap_host::{db::DbError, http::response::Response};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Code {
    InvalidRequest,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    RateLimited,
    InvalidCredentials,
    SecondFactorRequired,
    InviteInvalid,
    SignupClosed,
    TooLarge,
    UnsupportedMediaType,
    CrossOrigin,
    MethodNotAllowed,
    Internal,
    /// A part we depend on does not answer (the Akteur of an Aktion): worth trying again.
    Unavailable,
}

impl Code {
    pub fn status(self) -> u16 {
        match self {
            Code::InvalidRequest => 400,
            Code::Unauthorized | Code::InvalidCredentials | Code::SecondFactorRequired => 401,
            Code::Forbidden | Code::CrossOrigin | Code::SignupClosed => 403,
            Code::NotFound | Code::InviteInvalid => 404,
            Code::MethodNotAllowed => 405,
            Code::Conflict => 409,
            Code::TooLarge => 413,
            Code::UnsupportedMediaType => 415,
            Code::RateLimited => 429,
            Code::Internal => 500,
            Code::Unavailable => 503,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Code::InvalidRequest => "invalid_request",
            Code::Unauthorized => "unauthorized",
            Code::Forbidden => "forbidden",
            Code::NotFound => "not_found",
            Code::Conflict => "conflict",
            Code::RateLimited => "rate_limited",
            Code::InvalidCredentials => "invalid_credentials",
            Code::SecondFactorRequired => "second_factor_required",
            Code::InviteInvalid => "invite_invalid",
            Code::SignupClosed => "signup_closed",
            Code::TooLarge => "too_large",
            Code::UnsupportedMediaType => "unsupported_media_type",
            Code::CrossOrigin => "cross_origin",
            Code::MethodNotAllowed => "method_not_allowed",
            Code::Internal => "internal",
            Code::Unavailable => "unavailable",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: Code,
    /// Sent to the client: short, English, no values.
    pub detail: String,
    /// Only for the log: what really went wrong (a database message may hold values, so it is never sent).
    pub cause: Option<String>,
}

pub fn fail(code: Code, detail: impl Into<String>) -> Failure {
    Failure { code, detail: detail.into(), cause: None }
}

impl From<DbError> for Failure {
    fn from(e: DbError) -> Failure {
        Failure { code: Code::Internal, detail: "database".into(), cause: Some(e.message) }
    }
}

impl Failure {
    pub fn response(&self) -> Response {
        Response::error(self.code.status(), self.code.as_str(), &self.detail)
    }
}

pub type Done<T = Response> = Result<T, Failure>;

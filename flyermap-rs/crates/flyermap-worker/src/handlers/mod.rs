//! One file per resource. A handler gets the database, the caller and the request and returns a response; errors it can name are `ApiError`s.
pub mod basemap;
pub mod body;
pub mod cleanup;
pub mod meta;
pub mod notes;
pub mod ops;
pub mod packs;
pub mod progress;
pub mod rooms;
pub mod state;
pub mod window;

use crate::{db::DbError, http::response::Response};
use flyermap_wire::{ApiError, ErrorCode};

/// What a handler returns: an answer, or a database failure the app turns into a 500.
pub type Outcome = Result<Response, DbError>;

pub fn fail(code: ErrorCode, message: &str) -> Outcome {
    Ok(Response::error(&ApiError::with(code, message)))
}

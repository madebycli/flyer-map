//! The Worker. Everything that decides is here and runs natively in tests; the Cloudflare entry (`entry`, wasm only) only translates the platform's
//! request into ours and back.
//!
//! `http` (request, response, router, observability), `db` (the database seam: SQLite natively, D1 in the Worker), `access` (who is asking),
//! `repo` (the queries), `handlers` (one file per resource), `app` (puts them together).
pub mod access;
pub mod app;
pub mod db;
pub mod handlers;
pub mod http;
pub mod repo;
pub mod time;

pub use app::{App, Options};
pub use http::{request::Request, response::Response};

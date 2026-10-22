//! The Flyer Map 6 server (Plan 061). Today: the directory and the sign-in/invitation API under `/v6`. The Aktion actors join it next.
//!
//! `directory` (queries on the D1 database, one file per table), `auth` (sign-in ceremonies and the caller of a request), `api` (the HTTP
//! handlers), `app` (puts a request through: origin check, caller, route, log line).
pub mod api;
pub mod app;
pub mod auth;
pub mod config;
pub mod directory;
pub mod env;
pub mod error;
pub mod kdf;
pub mod seal;

pub use app::App;
pub use env::Env;

/// The directory schema, applied by tools and tests (`wrangler d1 migrations` uses the same file).
pub const SCHEMA: &str = include_str!("../migrations/0001_directory.sql");

//! The Flyer Map 6 server (Plan 061): the directory and the sign-in/invitation API under `/v6`, and the way to the Akteur of each Aktion.
//!
//! `akteur` (edge → Akteur: link, HTTP surface, live channel), `directory` (queries on the D1 database, one file per table), `auth` (sign-in ceremonies and the caller of a request), `api` (the HTTP
//! handlers), `app` (puts a request through: origin check, caller, route, log line).
pub mod akteur;
#[cfg(target_arch = "wasm32")]
mod akteur_host;
pub mod api;
pub mod app;
pub mod auth;
pub mod config;
pub mod directory;
#[cfg(target_arch = "wasm32")]
mod entry;
pub mod env;
pub mod error;
pub mod kdf;
#[cfg(target_arch = "wasm32")]
mod kdf_web;
pub mod seal;

pub use app::App;
pub use env::Env;

/// The directory schema, applied by tools and tests (`wrangler d1 migrations` uses the same file).
pub const SCHEMA: &str = include_str!("../migrations/0001_directory.sql");

//! The platform seam shared by every Worker of Flyer Map: nothing here knows a product rule.
//!
//! `db` (the database: SQLite natively, D1 in the Worker), `http` (request and response values, request log lines), `rand`/`time` (secrets and
//! the clock as the database stores it), `upstream` (outgoing requests), `platform` (variables and rate limiters).
pub mod db;
pub mod http;
pub mod platform;
pub mod rand;
pub mod time;
pub mod upstream;

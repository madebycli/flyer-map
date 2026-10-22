//! Every SQL statement of the Akteur lives in this module and nowhere else. They only read and write rows by ids the caller names: which ids a person may
//! touch was decided before, by `flyermap_identity::decide`, never in a `WHERE`.
//!
//! Statements bind at most 100 parameters (the Durable Object's limit): lists are cut into chunks of [`IN_CHUNK`].
pub mod areas;
pub mod done;
pub mod groups;
pub mod log;
pub mod marks;
pub mod meta;
pub mod notes;
pub mod runs;

use crate::sql::{Row, SqlError, Value};
use serde::{de::DeserializeOwned, Serialize};

/// Keys or ids per `IN (...)`.
pub const IN_CHUNK: usize = 50;

/// `?,?,?` for `n` parameters.
pub(crate) fn placeholders(n: usize) -> String {
    let mut out = String::with_capacity(n * 2);
    for i in 0..n {
        if i > 0 {
            out.push(',');
        }
        out.push('?');
    }
    out
}

/// A closed set of names (an enum with `rename_all`) as the text it has in the protocol.
pub(crate) fn tag<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(text)) => text,
        _ => String::new(),
    }
}

pub(crate) fn untag<T: DeserializeOwned>(text: &str) -> Result<T, SqlError> {
    serde_json::from_value(serde_json::Value::String(text.to_string())).map_err(|_| SqlError::new(format!("unknown name in storage: {text}")))
}

pub(crate) fn json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

pub(crate) fn unjson<T: DeserializeOwned>(text: &str) -> Result<T, SqlError> {
    serde_json::from_str(text).map_err(|e| SqlError::new(format!("bad json in storage: {e}")))
}

/// One number out of a one-row, one-column answer (a count, a maximum).
pub(crate) fn scalar(rows: &[Row]) -> Result<i64, SqlError> {
    rows.first().ok_or_else(|| SqlError::new("no row for a count"))?.int(0)
}

pub(crate) fn text_or_null(value: Option<&str>) -> Value {
    value.map_or(Value::Null, Value::from)
}

//! Small facts about the Aktion itself: layout version, whose storage this is, the Akteur's clock, the floor of the log.
use crate::sql::{Sql, SqlError, Value};

pub const SCHEMA: &str = "schema";
pub const ORG: &str = "org";
pub const AKTION: &str = "aktion";
pub const CLOCK: &str = "clock";
pub const FLOOR: &str = "floor";

pub fn get<S: Sql>(sql: &mut S, key: &str) -> Result<Option<String>, SqlError> {
    let rows = sql.query("SELECT v FROM meta WHERE k = ?", &[Value::from(key)])?;
    rows.first().map(|r| r.text(0).map(str::to_string)).transpose()
}

pub fn set<S: Sql>(sql: &mut S, key: &str, value: &str) -> Result<(), SqlError> {
    sql.execute("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", &[Value::from(key), Value::from(value)])
}

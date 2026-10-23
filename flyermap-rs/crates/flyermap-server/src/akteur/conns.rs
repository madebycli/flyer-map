//! The connections of an Akteur outlive its sleep: each one is a row next to the Akteur's own tables, in the same SQLite. The sockets themselves are the
//! runtime's (hibernation); the row says whose socket it is. Written against `Sql`, so it is tested on native SQLite and runs on the Durable Object's.
use super::{link::Link, live::Conn};
use flyermap_aktion::{Sql, SqlError, Value};

pub fn install<S: Sql>(sql: &mut S) -> Result<(), SqlError> {
    sql.execute("CREATE TABLE IF NOT EXISTS shell_conn (id TEXT PRIMARY KEY, link TEXT NOT NULL, subscribed INTEGER NOT NULL) WITHOUT ROWID", &[])
}

pub fn load<S: Sql>(sql: &mut S) -> Result<Vec<Conn>, SqlError> {
    sql.query("SELECT id, link, subscribed FROM shell_conn ORDER BY id", &[])?
        .iter()
        // a row that is not a connection (hand-edited) is not one
        .filter_map(|row| match (row.text(0), row.text(1), row.flag(2)) {
            (Ok(id), Ok(link), Ok(subscribed)) => serde_json::from_str::<Link>(link).ok().map(|link| Ok(Conn { id: id.to_string(), link, subscribed })),
            (Err(e), ..) | (_, Err(e), _) | (.., Err(e)) => Some(Err(e)),
        })
        .collect()
}

pub fn store<S: Sql>(sql: &mut S, conn: &Conn) -> Result<(), SqlError> {
    let link = serde_json::to_string(&conn.link).map_err(|e| SqlError::new(e.to_string()))?;
    sql.execute(
        "INSERT OR REPLACE INTO shell_conn (id, link, subscribed) VALUES (?, ?, ?)",
        &[conn.id.as_str().into(), Value::Text(link), conn.subscribed.into()],
    )
}

pub fn forget<S: Sql>(sql: &mut S, id: &str) -> Result<(), SqlError> {
    sql.execute("DELETE FROM shell_conn WHERE id = ?", &[id.into()])
}

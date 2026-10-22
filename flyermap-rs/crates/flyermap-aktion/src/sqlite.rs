//! The native host: SQLite through `rusqlite` (bundled). For tests, measurements and tools; the Worker never contains it. It only speaks what
//! [`Sql`] says, with no function or pragma the Durable Object's SQLite lacks.
use crate::sql::{Row, Sql, SqlError, Value};
use rusqlite::{params_from_iter, types::Value as Cell, types::ValueRef, Connection};
use std::path::Path;

pub struct RusqliteSql {
    conn: Connection,
    depth: u32,
    /// Statements still allowed before every statement fails (fault injection for tests); `None`: no limit.
    budget: Option<u64>,
}

fn failed(error: rusqlite::Error) -> SqlError {
    SqlError::new(error.to_string())
}

fn cell(value: &Value) -> Cell {
    match value {
        Value::Null => Cell::Null,
        Value::Int(v) => Cell::Integer(*v),
        Value::Real(v) => Cell::Real(*v),
        Value::Text(v) => Cell::Text(v.clone()),
    }
}

impl RusqliteSql {
    pub fn memory() -> Result<RusqliteSql, SqlError> {
        Ok(RusqliteSql { conn: Connection::open_in_memory().map_err(failed)?, depth: 0, budget: None })
    }

    pub fn file(path: &Path) -> Result<RusqliteSql, SqlError> {
        Ok(RusqliteSql { conn: Connection::open(path).map_err(failed)?, depth: 0, budget: None })
    }

    /// Let only the next `statements` statements through; the one after fails, and so does every later one, until the limit is lifted with `None`. This is
    /// how tests prove that a command that dies halfway leaves nothing behind.
    pub fn fail_after(&mut self, statements: Option<u64>) {
        self.budget = statements;
    }

    fn spend(&mut self) -> Result<(), SqlError> {
        match &mut self.budget {
            Some(0) => Err(SqlError::new("injected failure")),
            Some(left) => {
                *left -= 1;
                Ok(())
            }
            None => Ok(()),
        }
    }

    /// Bytes the database occupies (pages in use times page size): what a Durable Object would be charged for.
    pub fn size_bytes(&mut self) -> Result<u64, SqlError> {
        let pages: i64 = self.conn.query_row("PRAGMA page_count", [], |r| r.get(0)).map_err(failed)?;
        let free: i64 = self.conn.query_row("PRAGMA freelist_count", [], |r| r.get(0)).map_err(failed)?;
        let size: i64 = self.conn.query_row("PRAGMA page_size", [], |r| r.get(0)).map_err(failed)?;
        Ok(u64::try_from((pages - free).max(0) * size).unwrap_or(0))
    }
}

impl Sql for RusqliteSql {
    fn execute(&mut self, sql: &str, params: &[Value]) -> Result<(), SqlError> {
        self.spend()?;
        let mut statement = self.conn.prepare_cached(sql).map_err(failed)?;
        statement.execute(params_from_iter(params.iter().map(cell))).map_err(failed)?;
        Ok(())
    }

    fn query(&mut self, sql: &str, params: &[Value]) -> Result<Vec<Row>, SqlError> {
        self.spend()?;
        let mut statement = self.conn.prepare_cached(sql).map_err(failed)?;
        let columns = statement.column_count();
        let mut rows = statement.query(params_from_iter(params.iter().map(cell))).map_err(failed)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(failed)? {
            let mut values = Vec::with_capacity(columns);
            for i in 0..columns {
                values.push(match row.get_ref(i).map_err(failed)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(v) => Value::Int(v),
                    ValueRef::Real(v) => Value::Real(v),
                    ValueRef::Text(v) => Value::Text(String::from_utf8_lossy(v).into_owned()),
                    ValueRef::Blob(_) => return Err(SqlError::new("blob in a result")),
                });
            }
            out.push(Row(values));
        }
        Ok(out)
    }

    fn atomically<T, E: From<SqlError>>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, E>) -> Result<T, E> {
        if self.depth > 0 {
            return f(self);
        }
        self.conn.execute_batch("BEGIN").map_err(failed)?;
        self.depth = 1;
        let result = f(self);
        self.depth = 0;
        match result {
            Ok(value) => {
                if let Err(error) = self.conn.execute_batch("COMMIT") {
                    let _ = self.conn.execute_batch("ROLLBACK");
                    return Err(failed(error).into());
                }
                Ok(value)
            }
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
}

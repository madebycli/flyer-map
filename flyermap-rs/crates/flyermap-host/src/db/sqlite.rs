//! SQLite for tests and tools: the same SQL as D1, with D1's habits (rows as JSON objects, a batch is one transaction).
use super::{Db, DbError, Param, Row, Stmt};
use rusqlite::{types::ValueRef, Connection};
use serde_json::{Number, Value};
use std::cell::RefCell;

pub struct SqliteDb {
    conn: RefCell<Connection>,
}

fn err(e: rusqlite::Error) -> DbError {
    DbError { message: e.to_string() }
}

fn bind(params: &[Param]) -> Vec<rusqlite::types::Value> {
    params
        .iter()
        .map(|p| match p {
            Param::Null => rusqlite::types::Value::Null,
            Param::Int(v) => rusqlite::types::Value::Integer(*v),
            Param::Real(v) => rusqlite::types::Value::Real(*v),
            Param::Text(v) => rusqlite::types::Value::Text(v.clone()),
            Param::Blob(v) => rusqlite::types::Value::Blob(v.clone()),
        })
        .collect()
}

impl SqliteDb {
    pub fn in_memory() -> Result<SqliteDb, DbError> {
        Ok(SqliteDb { conn: RefCell::new(Connection::open_in_memory().map_err(err)?) })
    }
    /// Run a script (schema, seed rows).
    pub fn exec(&self, sql: &str) -> Result<(), DbError> {
        self.conn.borrow().execute_batch(sql).map_err(err)
    }
}

impl Db for SqliteDb {
    async fn all(&self, stmt: &Stmt) -> Result<Vec<Row>, DbError> {
        let conn = self.conn.borrow();
        let mut prepared = conn.prepare(&stmt.sql).map_err(err)?;
        let names: Vec<String> = prepared.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = prepared.query(rusqlite::params_from_iter(bind(&stmt.params))).map_err(err)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(err)? {
            let mut map = Row::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i).map_err(err)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(v) => Value::Number(v.into()),
                    ValueRef::Real(v) => Number::from_f64(v).map_or(Value::Null, Value::Number),
                    ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                    ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::Number((*x).into())).collect()),
                };
                map.insert(name.clone(), value);
            }
            out.push(map);
        }
        Ok(out)
    }

    async fn batch(&self, stmts: &[Stmt]) -> Result<Vec<u64>, DbError> {
        let mut conn = self.conn.borrow_mut();
        let tx = conn.transaction().map_err(err)?;
        let mut changes = Vec::with_capacity(stmts.len());
        for stmt in stmts {
            let n = tx.execute(&stmt.sql, rusqlite::params_from_iter(bind(&stmt.params))).map_err(err)?;
            changes.push(n as u64);
        }
        tx.commit().map_err(err)?;
        Ok(changes)
    }
}

//! The database seam. Handlers only see [`Db`]: SQLite natively (tests, tools), D1 in the Worker. Rows come back as JSON objects (that is what D1
//! gives) and are read into small typed structs where they are used.
#[cfg(target_arch = "wasm32")]
pub mod d1;
#[cfg(not(target_arch = "wasm32"))]
pub mod sqlite;

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

#[derive(Clone, Debug, PartialEq)]
pub enum Param {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
}

impl From<&str> for Param {
    fn from(v: &str) -> Param {
        Param::Text(v.to_string())
    }
}
impl From<String> for Param {
    fn from(v: String) -> Param {
        Param::Text(v)
    }
}
impl From<&String> for Param {
    fn from(v: &String) -> Param {
        Param::Text(v.clone())
    }
}
impl From<i64> for Param {
    fn from(v: i64) -> Param {
        Param::Int(v)
    }
}
impl From<u64> for Param {
    fn from(v: u64) -> Param {
        Param::Int(i64::try_from(v).unwrap_or(i64::MAX))
    }
}
impl From<usize> for Param {
    fn from(v: usize) -> Param {
        Param::Int(i64::try_from(v).unwrap_or(i64::MAX))
    }
}
impl<T: Into<Param>> From<Option<T>> for Param {
    fn from(v: Option<T>) -> Param {
        v.map_or(Param::Null, Into::into)
    }
}

/// One SQL statement with its parameters (`?` placeholders, in order).
#[derive(Clone, Debug, PartialEq)]
pub struct Stmt {
    pub sql: String,
    pub params: Vec<Param>,
}

pub fn stmt(sql: impl Into<String>, params: Vec<Param>) -> Stmt {
    Stmt { sql: sql.into(), params }
}

/// `params![a, b, c]` turns each value into a [`Param`].
#[macro_export]
macro_rules! params {
    ($($value:expr),* $(,)?) => { vec![$($crate::db::Param::from($value)),*] };
}

pub type Row = Map<String, Value>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DbError {
    pub message: String,
}

impl DbError {
    /// A table or column that a migration has not created yet: the caller decides whether that means "nothing there".
    pub fn is_missing_schema(&self) -> bool {
        self.message.contains("no such table") || self.message.contains("no such column")
    }
}

#[allow(async_fn_in_trait)] // single-threaded hosts (the Worker, the tests): no Send bound wanted
pub trait Db {
    async fn all(&self, stmt: &Stmt) -> Result<Vec<Row>, DbError>;
    /// Runs all statements in one transaction; returns the changed rows per statement.
    async fn batch(&self, stmts: &[Stmt]) -> Result<Vec<u64>, DbError>;

    async fn first(&self, stmt: &Stmt) -> Result<Option<Row>, DbError> {
        Ok(self.all(stmt).await?.into_iter().next())
    }
}

/// Read rows into a struct.
pub fn decode<T: DeserializeOwned>(rows: Vec<Row>) -> Result<Vec<T>, DbError> {
    rows.into_iter().map(|row| serde_json::from_value(Value::Object(row)).map_err(|e| DbError { message: format!("row shape: {e}") })).collect()
}

pub fn decode_one<T: DeserializeOwned>(row: Option<Row>) -> Result<Option<T>, DbError> {
    row.map(|r| serde_json::from_value(Value::Object(r)).map_err(|e| DbError { message: format!("row shape: {e}") })).transpose()
}

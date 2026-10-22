//! The storage the Akteur needs, as small as it can be. Two hosts implement it: `RusqliteSql` (native SQLite, tests and tools) and the Durable Object's
//! SQL storage (the Worker). Both speak SQLite, so the SQL of this crate (`schema`, `queries`) is written once.
//!
//! What the hosts must keep to, because the Durable Object's storage is stricter than SQLite:
//! - statements bind at most 100 parameters, and no `PRAGMA`, `BEGIN` or `SAVEPOINT` is ever sent (a transaction is [`Sql::atomically`]);
//! - numbers come back as JavaScript numbers, so integers stay below 2^53 (timestamps in milliseconds do) and [`Row::int`] also accepts a whole `Real`;
//! - nothing relies on the count of affected rows: [`Sql::execute`] returns none (the Durable Object does not report it); a statement that must know asks with a `SELECT`.
use thiserror::Error;

/// A value in a statement or a row. No blobs: everything stored is text, integers or floats.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
}

impl From<i64> for Value {
    fn from(v: i64) -> Value {
        Value::Int(v)
    }
}
impl From<u64> for Value {
    fn from(v: u64) -> Value {
        Value::Int(i64::try_from(v).unwrap_or(i64::MAX))
    }
}
impl From<u32> for Value {
    fn from(v: u32) -> Value {
        Value::Int(i64::from(v))
    }
}
impl From<u16> for Value {
    fn from(v: u16) -> Value {
        Value::Int(i64::from(v))
    }
}
impl From<u8> for Value {
    fn from(v: u8) -> Value {
        Value::Int(i64::from(v))
    }
}
impl From<usize> for Value {
    fn from(v: usize) -> Value {
        Value::Int(i64::try_from(v).unwrap_or(i64::MAX))
    }
}
impl From<bool> for Value {
    fn from(v: bool) -> Value {
        Value::Int(i64::from(v))
    }
}
impl From<f64> for Value {
    fn from(v: f64) -> Value {
        Value::Real(v)
    }
}
impl From<&str> for Value {
    fn from(v: &str) -> Value {
        Value::Text(v.to_string())
    }
}
impl From<String> for Value {
    fn from(v: String) -> Value {
        Value::Text(v)
    }
}
impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(v: Option<T>) -> Value {
        v.map_or(Value::Null, Into::into)
    }
}

/// The storage failed or answered something the code did not expect. Never holds user data (messages are the engine's own).
#[derive(Clone, Debug, PartialEq, Eq, Error)]
#[error("storage: {0}")]
pub struct SqlError(pub String);

impl SqlError {
    pub fn new(message: impl Into<String>) -> SqlError {
        SqlError(message.into())
    }
}

/// One row of an answer, read by position.
#[derive(Clone, Debug, PartialEq)]
pub struct Row(pub Vec<Value>);

impl Row {
    fn at(&self, i: usize) -> Result<&Value, SqlError> {
        self.0.get(i).ok_or_else(|| SqlError::new(format!("column {i} missing")))
    }

    pub fn int(&self, i: usize) -> Result<i64, SqlError> {
        match self.at(i)? {
            Value::Int(v) => Ok(*v),
            Value::Real(v) if v.fract() == 0.0 && v.abs() < 9.0e15 => Ok(*v as i64),
            other => Err(SqlError::new(format!("column {i} is not an integer: {}", kind(other)))),
        }
    }

    pub fn uint(&self, i: usize) -> Result<u64, SqlError> {
        u64::try_from(self.int(i)?).map_err(|_| SqlError::new(format!("column {i} is negative")))
    }

    pub fn flag(&self, i: usize) -> Result<bool, SqlError> {
        Ok(self.int(i)? != 0)
    }

    pub fn real(&self, i: usize) -> Result<f64, SqlError> {
        match self.at(i)? {
            Value::Real(v) => Ok(*v),
            Value::Int(v) => Ok(*v as f64),
            other => Err(SqlError::new(format!("column {i} is not a number: {}", kind(other)))),
        }
    }

    pub fn text(&self, i: usize) -> Result<&str, SqlError> {
        match self.at(i)? {
            Value::Text(v) => Ok(v),
            other => Err(SqlError::new(format!("column {i} is not text: {}", kind(other)))),
        }
    }

    pub fn opt_text(&self, i: usize) -> Result<Option<&str>, SqlError> {
        match self.at(i)? {
            Value::Null => Ok(None),
            _ => self.text(i).map(Some),
        }
    }

    pub fn opt_uint(&self, i: usize) -> Result<Option<u64>, SqlError> {
        match self.at(i)? {
            Value::Null => Ok(None),
            _ => self.uint(i).map(Some),
        }
    }
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Int(_) => "integer",
        Value::Real(_) => "real",
        Value::Text(_) => "text",
    }
}

/// A synchronous SQLite. One writer, no concurrency: the Akteur is the only user of its storage.
pub trait Sql {
    /// Run one statement that writes (or changes the schema).
    fn execute(&mut self, sql: &str, params: &[Value]) -> Result<(), SqlError>;

    /// Run one statement that reads; all rows come back.
    fn query(&mut self, sql: &str, params: &[Value]) -> Result<Vec<Row>, SqlError>;

    /// Run `f` so that all its statements happen or none: on `Err` everything it wrote is undone. A call inside `f` joins the outer transaction.
    fn atomically<T, E: From<SqlError>>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, E>) -> Result<T, E>;
}

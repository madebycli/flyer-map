//! The Akteur's storage in a Durable Object: `ctx.storage.sql`. One SQLite per Aktion, one writer, and the transaction is `ctx.storage.transactionSync`
//! (which undoes everything its callback wrote when the callback throws). SQLite's own `BEGIN` and `SAVEPOINT` are refused by the Durable Object, which is
//! why the Akteur never sends them.
//!
//! The JavaScript API is called directly (`worker` keeps its SQL wrapper private): `sql.exec(query, ...bindings)` returns a cursor, and `cursor.raw()`
//! yields each row as an array of cells, which is the shape [`Row`] reads by position.
use flyermap_aktion::{sql::MAX_SAFE_INT, Row, Sql, SqlError, Value};
use js_sys::{Array, Function, Number, Reflect};
use wasm_bindgen::{closure::ScopedClosure, JsCast, JsValue};
use worker::State;

pub struct DoSql {
    /// `ctx.storage.sql` and its `exec`.
    sql: JsValue,
    exec: Function,
    /// `ctx.storage` and its `transactionSync`.
    storage: JsValue,
    transaction_sync: Function,
    depth: u32,
}

fn describe(e: &JsValue) -> String {
    e.as_string()
        .or_else(|| Reflect::get(e, &JsValue::from_str("message")).ok().and_then(|m| m.as_string()))
        .unwrap_or_else(|| "a JavaScript error".to_string())
}

fn member(of: &JsValue, name: &str) -> Result<JsValue, SqlError> {
    Reflect::get(of, &JsValue::from_str(name)).map_err(|e| SqlError::new(format!("{name}: {}", describe(&e))))
}

fn function(of: &JsValue, name: &str) -> Result<Function, SqlError> {
    member(of, name)?.dyn_into::<Function>().map_err(|_| SqlError::new(format!("{name} is not a function")))
}

impl DoSql {
    pub fn new(state: &State) -> Result<DoSql, SqlError> {
        let raw: &JsValue = state.as_raw().as_ref();
        let storage = member(raw, "storage")?;
        let sql = member(&storage, "sql")?;
        Ok(DoSql { exec: function(&sql, "exec")?, sql, transaction_sync: function(&storage, "transactionSync")?, storage, depth: 0 })
    }

    /// Run one statement; its rows, each as the cells of that row.
    fn run(&self, query: &str, params: &[Value]) -> Result<Array, SqlError> {
        let args = Array::new();
        args.push(&JsValue::from_str(query));
        for p in params {
            args.push(&bind(p)?);
        }
        let cursor = self.exec.apply(&self.sql, &args).map_err(|e| SqlError::new(describe(&e)))?;
        let rows = function(&cursor, "raw")?.call0(&cursor).map_err(|e| SqlError::new(describe(&e)))?;
        // using up the cursor is what finishes the statement
        Ok(Array::from(&rows))
    }
}

fn bind(p: &Value) -> Result<JsValue, SqlError> {
    match p {
        Value::Null => Ok(JsValue::NULL),
        // a JavaScript number holds integers exactly up to 2^53 - 1; beyond it the value would change on the way in
        Value::Int(i) if i.unsigned_abs() > MAX_SAFE_INT => Err(SqlError::new("an integer outside what a JavaScript number holds exactly")),
        Value::Int(i) => Ok(JsValue::from_f64(*i as f64)),
        Value::Real(r) => Ok(JsValue::from_f64(*r)),
        Value::Text(t) => Ok(JsValue::from_str(t)),
    }
}

/// A cell as the Akteur reads it. A whole number comes back as an integer (JavaScript has one kind of number); `Row::int` and `Row::real` accept both.
fn cell(c: JsValue) -> Result<Value, SqlError> {
    if c.is_null() || c.is_undefined() {
        Ok(Value::Null)
    } else if let Some(text) = c.as_string() {
        Ok(Value::Text(text))
    } else if let Some(number) = c.as_f64() {
        Ok(if Number::is_safe_integer(&c) { Value::Int(number as i64) } else { Value::Real(number) })
    } else if let Some(flag) = c.as_bool() {
        Ok(Value::Int(i64::from(flag)))
    } else {
        Err(SqlError::new("a cell that is neither text nor a number (a blob?)"))
    }
}

impl Sql for DoSql {
    fn execute(&mut self, sql: &str, params: &[Value]) -> Result<(), SqlError> {
        self.run(sql, params).map(|_| ())
    }

    fn query(&mut self, sql: &str, params: &[Value]) -> Result<Vec<Row>, SqlError> {
        self.run(sql, params)?.iter().map(|row| Array::from(&row).iter().map(cell).collect::<Result<Vec<_>, _>>().map(Row)).collect()
    }

    fn atomically<T, E: From<SqlError>>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, E>) -> Result<T, E> {
        if self.depth > 0 {
            return f(self);
        }
        self.depth = 1;
        let (storage, transaction_sync) = (self.storage.clone(), self.transaction_sync.clone());
        let mut outcome: Option<Result<T, E>> = None;
        let mut f = Some(f);
        let called = {
            let (this, slot) = (&mut *self, &mut outcome);
            let mut body = || -> Result<JsValue, JsValue> {
                let Some(f) = f.take() else { return Err(JsValue::from_str("the transaction callback ran twice")) };
                match f(this) {
                    Ok(done) => {
                        *slot = Some(Ok(done));
                        Ok(JsValue::UNDEFINED)
                    }
                    Err(failed) => {
                        *slot = Some(Err(failed));
                        // throwing is how the Durable Object is told to undo what the callback wrote
                        Err(JsValue::from_str("rolled back"))
                    }
                }
            };
            let callback = ScopedClosure::borrow_mut(&mut body);
            transaction_sync.call1(&storage, callback.as_ref())
        };
        self.depth = 0;
        match (outcome, called) {
            (Some(result), _) => result,
            (None, Err(e)) => Err(E::from(SqlError::new(format!("transactionSync: {}", describe(&e))))),
            (None, Ok(_)) => Err(E::from(SqlError::new("transactionSync did not run the callback"))),
        }
    }
}

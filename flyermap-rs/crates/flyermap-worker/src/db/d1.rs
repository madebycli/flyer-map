//! D1 in the Worker. Rows come back as JSON objects; a batch is one transaction (D1's own guarantee).
use super::{Db, DbError, Param, Row, Stmt};
use wasm_bindgen_shim::JsValue;
use worker::{D1Database, D1PreparedStatement};

mod wasm_bindgen_shim {
    pub use worker::wasm_bindgen::JsValue;
}

pub struct D1Db(pub D1Database);

fn err(e: impl std::fmt::Display) -> DbError {
    DbError { message: e.to_string() }
}

fn values(params: &[Param]) -> Vec<JsValue> {
    params
        .iter()
        .map(|p| match p {
            Param::Null => JsValue::NULL,
            Param::Int(v) => JsValue::from_f64(*v as f64),
            Param::Real(v) => JsValue::from_f64(*v),
            Param::Text(v) => JsValue::from_str(v),
            // D1 takes a blob as an ArrayBuffer
            Param::Blob(v) => worker::js_sys::Uint8Array::from(v.as_slice()).buffer().into(),
        })
        .collect()
}

impl D1Db {
    fn prepare(&self, stmt: &Stmt) -> Result<D1PreparedStatement, DbError> {
        self.0.prepare(&stmt.sql).bind(&values(&stmt.params)).map_err(err)
    }
}

impl Db for D1Db {
    async fn all(&self, stmt: &Stmt) -> Result<Vec<Row>, DbError> {
        let result = self.prepare(stmt)?.all().await.map_err(err)?;
        let rows: Vec<serde_json::Value> = result.results().map_err(err)?;
        Ok(rows
            .into_iter()
            .filter_map(|v| match v {
                serde_json::Value::Object(map) => Some(map),
                _ => None,
            })
            .collect())
    }

    async fn batch(&self, stmts: &[Stmt]) -> Result<Vec<u64>, DbError> {
        let prepared = stmts.iter().map(|s| self.prepare(s)).collect::<Result<Vec<_>, _>>()?;
        let results = self.0.batch(prepared).await.map_err(err)?;
        Ok(results.iter().map(|r| r.meta().ok().flatten().and_then(|m| m.changes).unwrap_or(0) as u64).collect())
    }
}

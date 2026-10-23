//! Not part of the server. Built with `--features probe` only, so that the end-to-end test can ask a real Durable Object whether `DoSql::atomically` keeps
//! the promise the Akteur is built on: everything a transaction wrote happens, or none of it. The native tests cannot say it: the Durable Object's
//! `transactionSync` and the closure that throws into it exist only there.
use super::sql::DoSql;
use flyermap_aktion::{Sql, SqlError};
use serde_json::{json, Value};

fn rows(sql: &mut DoSql) -> i64 {
    sql.query("SELECT COUNT(*) FROM probe", &[]).and_then(|r| r[0].int(0)).unwrap_or(-1)
}

pub fn run(sql: &mut DoSql) -> Value {
    let mut steps: Vec<Value> = Vec::new();
    let mut check = |name: &str, passed: bool, detail: String| steps.push(json!({ "step": name, "passed": passed, "detail": detail }));
    let _ = sql.execute("CREATE TABLE IF NOT EXISTS probe (x INTEGER)", &[]);
    let _ = sql.execute("DELETE FROM probe", &[]);

    let done: Result<i32, SqlError> = sql.atomically(|s| s.execute("INSERT INTO probe VALUES (1)", &[]).map(|()| 42));
    check("a transaction that succeeds is kept and hands its value back", done == Ok(42) && rows(sql) == 1, format!("{done:?}, rows {}", rows(sql)));

    let failed: Result<(), SqlError> = sql.atomically(|s| {
        s.execute("INSERT INTO probe VALUES (2)", &[])?;
        s.execute("INSERT INTO probe VALUES (3)", &[])?;
        Err(SqlError::new("boom"))
    });
    check(
        "an error after writes undoes them and comes back unchanged",
        failed == Err(SqlError::new("boom")) && rows(sql) == 1,
        format!("{failed:?}, rows {}", rows(sql)),
    );

    let nested: Result<(), SqlError> = sql.atomically(|s| {
        s.execute("INSERT INTO probe VALUES (4)", &[])?;
        s.atomically(|s| {
            s.execute("INSERT INTO probe VALUES (5)", &[])?;
            Err::<(), _>(SqlError::new("inner"))
        })
    });
    check(
        "an error in a nested call undoes the outer writes too",
        nested == Err(SqlError::new("inner")) && rows(sql) == 1,
        format!("{nested:?}, rows {}", rows(sql)),
    );

    let joined: Result<(), SqlError> = sql.atomically(|s| {
        s.execute("INSERT INTO probe VALUES (6)", &[])?;
        s.atomically(|s| s.execute("INSERT INTO probe VALUES (7)", &[]))
    });
    check("nested calls that succeed join the outer transaction", joined.is_ok() && rows(sql) == 3, format!("{joined:?}, rows {}", rows(sql)));

    let broken: Result<(), SqlError> = sql.atomically(|s| {
        s.execute("INSERT INTO probe VALUES (8)", &[])?;
        s.execute("INSERT INTO no_such_table VALUES (9)", &[])
    });
    check("a statement the storage refuses undoes the writes before it", broken.is_err() && rows(sql) == 3, format!("{broken:?}, rows {}", rows(sql)));

    let after: Result<(), SqlError> = sql.atomically(|s| s.execute("INSERT INTO probe VALUES (10)", &[]));
    check("after a rollback the next transaction works", after.is_ok() && rows(sql) == 4, format!("{after:?}, rows {}", rows(sql)));

    let passed = steps.iter().all(|s| s["passed"] == true);
    json!({ "passed": passed, "steps": steps })
}

//! One log line per request (route template, status, time, database work, error code) and the headers that let client and server lines meet:
//! `x-request-id` (taken from the client or made here) and `Server-Timing`.
use serde_json::json;

/// Database work during one request.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DbStats {
    pub queries: u32,
    pub batches: u32,
    pub ms: f64,
    pub slowest_ms: f64,
}

/// The client's id when it is a plausible one, else `s-<random>` made by the host.
pub fn request_id(incoming: Option<&str>, make: impl FnOnce() -> String) -> String {
    match incoming {
        Some(id) if (4..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') => id.to_string(),
        _ => make(),
    }
}

pub fn server_timing(total_ms: f64, db: &DbStats) -> String {
    format!("total;dur={total_ms:.1}, db;dur={:.1};desc=\"{} q, {} b\"", db.ms, db.queries, db.batches)
}

pub fn log_line(rid: &str, route: &str, method: &str, status: u16, ms: f64, db: &DbStats, code: Option<&str>) -> String {
    let level = if status >= 500 {
        "error"
    } else if status >= 400 || ms > 1000.0 {
        "warn"
    } else {
        "info"
    };
    json!({
        "lvl": level, "msg": "v5 request", "rid": rid, "route": route, "method": method, "status": status, "ms": (ms * 10.0).round() / 10.0,
        "db": {"queries": db.queries, "batches": db.batches, "ms": (db.ms * 10.0).round() / 10.0, "slowestMs": (db.slowest_ms * 10.0).round() / 10.0},
        "code": code,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_lines() {
        assert_eq!(request_id(Some("c-1234abcd"), || "s-new".into()), "c-1234abcd");
        assert_eq!(request_id(Some("bad id"), || "s-new".into()), "s-new");
        let line = log_line("r1", "/api/v5/campaigns/:c/ops", "POST", 403, 2.34, &DbStats::default(), Some("cross_origin"));
        assert!(line.contains("\"lvl\":\"warn\"") && line.contains("\"code\":\"cross_origin\""), "{line}");
    }
}

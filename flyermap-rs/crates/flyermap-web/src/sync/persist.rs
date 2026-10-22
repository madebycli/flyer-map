//! The store on the device: the IndexedDB database `vf-v5-<Aktion>` with the records `outbox` (version, clock, queued edits, cursor) and
//! `overlay` (every known status), exactly as the React app writes them (`src/v5/store/idb.ts`), so a device keeps its queued edits when it
//! switches between the two apps. Queued edits are saved at once (an app kill must not lose them); the overlay is saved later and in bulk.
use crate::platform::idb;
use flyermap_core::Persisted;
use flyermap_diag::{count, diag, Level};
use serde_json::Value;
use wasm_bindgen::JsValue;

const STORE: &str = "state";

pub fn db_name(campaign: &str) -> String {
    format!("vf-v5-{campaign}")
}

/// The two records of a snapshot: the outbox without the overlay, and the overlay alone.
pub fn split(persisted: &Persisted) -> (Value, Value) {
    let mut outbox = serde_json::to_value(persisted).unwrap_or(Value::Null);
    let overlay = outbox.as_object_mut().and_then(|o| o.remove("overlay")).unwrap_or(Value::Array(Vec::new()));
    (outbox, overlay)
}

/// A snapshot from the two records; `None` when there is no outbox record of version 1 (nothing saved yet, or another format).
pub fn join(outbox: Option<Value>, overlay: Option<Value>) -> Option<Persisted> {
    let mut outbox = outbox?;
    if outbox.get("version").and_then(Value::as_u64) != Some(1) {
        return None;
    }
    outbox.as_object_mut()?.insert("overlay".into(), overlay.filter(Value::is_array).unwrap_or(Value::Array(Vec::new())));
    serde_json::from_value(outbox).ok()
}

fn to_js(value: &Value) -> Option<JsValue> {
    js_sys::JSON::parse(&value.to_string()).ok()
}

fn from_js(value: JsValue) -> Option<Value> {
    let text: String = js_sys::JSON::stringify(&value).ok()?.into();
    serde_json::from_str(&text).ok()
}

pub async fn load(campaign: &str) -> Option<Persisted> {
    let Some(db) = idb::open(&db_name(campaign), STORE).await else {
        diag!(Level::Warn, "store", code "store.idb.unavailable", "IndexedDB is not available: edits live in memory only");
        return None;
    };
    let outbox = db.get("outbox").await.and_then(from_js);
    let overlay = db.get("overlay").await.and_then(from_js);
    join(outbox, overlay)
}

/// Save a snapshot of the store; `with_overlay` also writes the (potentially large) overlay.
pub async fn save(campaign: &str, snapshot: &Persisted, with_overlay: bool) {
    let (outbox, overlay) = split(snapshot);
    let Some(db) = idb::open(&db_name(campaign), STORE).await else {
        return;
    };
    let mut records = Vec::new();
    if let Some(v) = to_js(&outbox) {
        records.push(("outbox", v));
    }
    if with_overlay {
        if let Some(v) = to_js(&overlay) {
            records.push(("overlay", v));
        }
    }
    if db.put(&records).await {
        count(if with_overlay { "idb.saved.all" } else { "idb.saved.outbox" }, 1);
    } else {
        count("idb.failed.save", 1);
        diag!(Level::Error, "store", code "store.idb.save_failed", "saving to IndexedDB failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_core::{Key, Status, Store};

    #[test]
    fn a_snapshot_survives_the_two_records() {
        let mut store = Store::new("dabc123");
        store.set(&[Key::house("1"), Key::segment("2")], Status::Completed, 1_800_000_000_000, &|_| Some("a".into()));
        let snapshot = store.snapshot(true);
        let (outbox, overlay) = split(&snapshot);
        assert!(outbox.get("overlay").is_none(), "the outbox record has no overlay");
        assert_eq!(outbox["version"], 1);
        assert_eq!(overlay.as_array().map(Vec::len), Some(2));
        assert_eq!(join(Some(outbox.clone()), Some(overlay)), Some(snapshot.clone()));
        let restored = Store::restore("dabc123", &join(Some(outbox), None).unwrap());
        assert_eq!(restored.pending_len(), 2, "queued edits survive without the overlay record");
    }

    #[test]
    fn a_record_of_another_format_is_not_read() {
        assert_eq!(join(Some(serde_json::json!({"version": 2})), None), None);
        assert_eq!(join(None, Some(serde_json::json!([]))), None);
    }

    #[test]
    fn the_typescript_record_shape_is_read() {
        let outbox = serde_json::json!({"version":1,"clock":{"wall":1800000000000u64,"counter":1,"node":"dx"},
            "pending":[{"id":"000mywpip68-0001-dx","key":"h:1","status":"completed","by":"dx","area":"a"}],"cursor":7});
        let overlay = serde_json::json!([["h:1",{"status":"completed","at":"000mywpip68-0001-dx","by":"dx"}]]);
        let p = join(Some(outbox), Some(overlay)).expect("the React app's records");
        assert_eq!((p.cursor, p.pending.len(), p.overlay.len()), (7, 1, 1));
    }
}

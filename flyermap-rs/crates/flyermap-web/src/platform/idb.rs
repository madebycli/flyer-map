//! IndexedDB as a few awaitable calls: open a database with one object store, read records, write several records in one transaction.
//! Every failure is `None`/`false` (private mode, quota, blocked site data): the caller keeps working in memory and logs it.
use js_sys::{Function, Promise};
use wasm_bindgen::{closure::Closure, JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

pub struct Db {
    db: web_sys::IdbDatabase,
    store: String,
}

/// A promise that settles when `wire` has hooked the browser's callbacks to `resolve` and `reject`.
async fn settle(wire: impl FnOnce(&Function, &Function)) -> Result<JsValue, JsValue> {
    let mut wire = Some(wire);
    let promise = Promise::new(&mut |resolve, reject| {
        if let Some(w) = wire.take() {
            w(&resolve, &reject);
        }
    });
    JsFuture::from(promise).await
}

/// Open (and on first use create) `name` with the object store `store`.
pub async fn open(name: &str, store: &str) -> Option<Db> {
    let factory = web_sys::window()?.indexed_db().ok()??;
    let request = factory.open_with_u32(name, 1).ok()?;
    let store_name = store.to_string();
    let upgrade = Closure::once_into_js(move |event: web_sys::IdbVersionChangeEvent| {
        let db = event.target().and_then(|t| t.dyn_into::<web_sys::IdbOpenDbRequest>().ok()).and_then(|r| r.result().ok());
        if let Some(db) = db.and_then(|d| d.dyn_into::<web_sys::IdbDatabase>().ok()) {
            if !db.object_store_names().contains(&store_name) {
                let _ = db.create_object_store(&store_name);
            }
        }
    });
    request.set_onupgradeneeded(Some(upgrade.unchecked_ref()));
    settle(|ok, fail| {
        request.set_onsuccess(Some(ok));
        request.set_onerror(Some(fail));
    })
    .await
    .ok()?;
    let db = request.result().ok()?.dyn_into::<web_sys::IdbDatabase>().ok()?;
    Some(Db { db, store: store.to_string() })
}

impl Db {
    /// The record under `key`, `None` when there is none or reading failed.
    pub async fn get(&self, key: &str) -> Option<JsValue> {
        let tx = self.db.transaction_with_str(&self.store).ok()?;
        let request = tx.object_store(&self.store).ok()?.get(&JsValue::from_str(key)).ok()?;
        settle(|ok, fail| {
            request.set_onsuccess(Some(ok));
            request.set_onerror(Some(fail));
        })
        .await
        .ok()?;
        request.result().ok().filter(|v| !v.is_undefined() && !v.is_null())
    }

    /// Write all records in one transaction; true once it is committed.
    pub async fn put(&self, records: &[(&str, JsValue)]) -> bool {
        let Ok(tx) = self.db.transaction_with_str_and_mode(&self.store, web_sys::IdbTransactionMode::Readwrite) else {
            return false;
        };
        let Ok(store) = tx.object_store(&self.store) else {
            return false;
        };
        for (key, value) in records {
            if store.put_with_key(value, &JsValue::from_str(key)).is_err() {
                return false;
            }
        }
        settle(|ok, fail| {
            tx.set_oncomplete(Some(ok));
            tx.set_onerror(Some(fail));
            tx.set_onabort(Some(fail));
        })
        .await
        .is_ok()
    }
}

impl Drop for Db {
    fn drop(&mut self) {
        self.db.close();
    }
}

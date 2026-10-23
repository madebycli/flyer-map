//! What the bridge to the server remembers for a start without a connection: the last answer of `/meta` (the Aktion, its Gebiete, what this device may do) and the
//! last map data of every Gebiet. They live in IndexedDB next to the store of the Aktion; reading a cache never replaces a live answer, it only stands in when
//! the server cannot be reached. A refusal of the server (not signed in, no such thing) is never answered from here: the screen has to say it.
use crate::platform::{idb, HttpError};
use js_sys::Uint8Array;
use wasm_bindgen::JsValue;

const STORE: &str = "entries";

/// Whether a failed request may be answered from what was remembered: the server was not reached at all, or it failed on its side.
pub fn may_use_cache(error: &HttpError) -> bool {
    error.status == 0 || error.status >= 500
}

fn db_name(base: &str) -> String {
    format!("fm-cache:{base}")
}

pub async fn put_text(base: &str, key: &str, text: &str) -> bool {
    match idb::open(&db_name(base), STORE).await {
        Some(db) => db.put(&[(key, JsValue::from_str(text))]).await,
        None => false,
    }
}

pub async fn get_text(base: &str, key: &str) -> Option<String> {
    idb::open(&db_name(base), STORE).await?.get(key).await?.as_string()
}

pub async fn put_bytes(base: &str, key: &str, bytes: &[u8]) -> bool {
    match idb::open(&db_name(base), STORE).await {
        Some(db) => db.put(&[(key, Uint8Array::from(bytes).into())]).await,
        None => false,
    }
}

pub async fn get_bytes(base: &str, key: &str) -> Option<Vec<u8>> {
    let value = idb::open(&db_name(base), STORE).await?.get(key).await?;
    Some(Uint8Array::new(&value).to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_server_that_was_not_reached_or_failed_is_answered_from_memory() {
        assert!(may_use_cache(&HttpError::network()));
        assert!(may_use_cache(&HttpError { status: 503, code: "http_503".into(), message: String::new() }));
        assert!(
            !may_use_cache(&HttpError { status: 401, code: "unauthorized".into(), message: String::new() }),
            "not signed in is not a reason to show old data"
        );
        assert!(!may_use_cache(&HttpError { status: 404, code: "not_found".into(), message: String::new() }));
        assert!(!may_use_cache(&HttpError { status: 403, code: "forbidden".into(), message: String::new() }));
    }
}

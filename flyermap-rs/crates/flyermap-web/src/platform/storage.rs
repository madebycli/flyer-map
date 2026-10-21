//! Key-value storage of this device. Browsers may refuse local storage (private mode, blocked site data, previews): reading then yields nothing
//! and writing yields an error the caller may ignore, and the value lives on in memory for the rest of the session, so a switch still works once.
use super::error::PlatformError;
use std::{cell::RefCell, collections::HashMap};

pub trait KeyValue {
    fn read(&self, key: &str) -> Option<String>;
    fn write(&self, key: &str, value: &str) -> Result<(), PlatformError>;
    fn remove(&self, key: &str) -> Result<(), PlatformError>;
}

/// A store that only lives in memory: the fallback of [`LocalStore`] and the stand-in in native tests.
#[derive(Default)]
pub struct MemoryStore(RefCell<HashMap<String, String>>);

impl KeyValue for MemoryStore {
    fn read(&self, key: &str) -> Option<String> {
        self.0.borrow().get(key).cloned()
    }
    fn write(&self, key: &str, value: &str) -> Result<(), PlatformError> {
        self.0.borrow_mut().insert(key.to_owned(), value.to_owned());
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<(), PlatformError> {
        self.0.borrow_mut().remove(key);
        Ok(())
    }
}

thread_local! {
    static SESSION: MemoryStore = MemoryStore::default();
}

/// `window.localStorage`, with the session memory as the fallback for every failure.
#[derive(Clone, Copy, Default)]
pub struct LocalStore;

impl LocalStore {
    fn area() -> Result<web_sys::Storage, PlatformError> {
        let window = web_sys::window().ok_or(PlatformError::NoWindow)?;
        // `local_storage()` itself throws a SecurityError when site data is blocked.
        match window.local_storage() {
            Ok(Some(area)) => Ok(area),
            _ => Err(PlatformError::StorageUnavailable),
        }
    }
}

impl KeyValue for LocalStore {
    fn read(&self, key: &str) -> Option<String> {
        let stored = Self::area()
            .ok()
            .and_then(|area| area.get_item(key).ok().flatten());
        stored.or_else(|| SESSION.with(|memory| memory.read(key)))
    }

    fn write(&self, key: &str, value: &str) -> Result<(), PlatformError> {
        SESSION.with(|memory| memory.write(key, value))?;
        Self::area()?
            .set_item(key, value)
            .map_err(|_| PlatformError::StorageWrite)
    }

    fn remove(&self, key: &str) -> Result<(), PlatformError> {
        SESSION.with(|memory| memory.remove(key))?;
        Self::area()?
            .remove_item(key)
            .map_err(|_| PlatformError::StorageWrite)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_round_trips() {
        let store = MemoryStore::default();
        assert_eq!(store.read("a"), None);
        store.write("a", "1").unwrap();
        assert_eq!(store.read("a").as_deref(), Some("1"));
        store.remove("a").unwrap();
        assert_eq!(store.read("a"), None);
    }
}

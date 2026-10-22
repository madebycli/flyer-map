//! The two small value types every entry is made of: its id and its position.
use std::{borrow::Borrow, fmt, sync::Arc};

/// The id of an entry as the host knows it (a street piece key, a note id, a command id). Opaque to the search; cheap to clone.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct Id(Arc<str>);

impl Id {
    pub fn new(text: &str) -> Id {
        Id(Arc::from(text))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for Id {
    fn from(text: &str) -> Id {
        Id::new(text)
    }
}

impl From<String> for Id {
    fn from(text: String) -> Id {
        Id(Arc::from(text))
    }
}

/// Lets a map keyed by `Id` be asked with a plain `&str` (the hash of an `Id` is the hash of its text).
impl Borrow<str> for Id {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A position on the map in degrees.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Point {
    pub lng: f64,
    pub lat: f64,
}

impl Point {
    pub fn new(lng: f64, lat: f64) -> Point {
        Point { lng, lat }
    }
}

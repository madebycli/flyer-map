//! What is asked: the text and the situation the person is in.
use crate::{entry::KindSet, id::Id, id::Point};

/// An entry the person used lately (opened, picked from the search, marked) and when. The unit of `at` is the host's; only the order counts.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Recent {
    pub id: Id,
    pub at: u64,
}

/// Where the person is and what they may see; it decides the order, never what matches.
#[derive(Clone, PartialEq, Debug)]
pub struct Context {
    /// The middle of the map: nearer entries rank higher, and a lone house number is read on the nearest street.
    pub center: Option<Point>,
    /// The Gebiet the person works in: entries in it rank higher.
    pub area: Option<Id>,
    /// Recently used entries, in any order.
    pub recent: Vec<Recent>,
    /// The kinds that may appear (a helper does not search people, say).
    pub kinds: KindSet,
    /// At most this many hits (capped at 200).
    pub limit: usize,
}

impl Default for Context {
    fn default() -> Context {
        Context { center: None, area: None, recent: Vec::new(), kinds: KindSet::ALL, limit: 20 }
    }
}

#[derive(Clone, PartialEq, Debug, Default)]
pub struct Query {
    pub text: String,
    pub context: Context,
}

impl Query {
    pub fn new(text: &str) -> Query {
        Query { text: text.to_string(), context: Context::default() }
    }
}

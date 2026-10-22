//! What comes back: ranked hits, and the same hits grouped by kind for sections in the list.
use crate::{
    entry::{Entry, Kind},
    id::Point,
};
use std::ops::Range;

#[derive(Clone, PartialEq, Debug)]
pub struct Hit {
    pub entry: Entry,
    pub kind: Kind,
    pub title: String,
    /// One short line under the title ("12 Häuser", "Haus · Nordstadt", "Befehl").
    pub subtitle: String,
    pub position: Option<Point>,
    /// Higher is better. Only the order is meant; the numbers have no unit.
    pub score: u32,
    /// Byte ranges of `title` that the query matched, sorted, non-overlapping, on character boundaries.
    pub highlights: Vec<Range<usize>>,
}

/// The hits of one kind, as indices into `Results::hits`, best first.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct KindGroup {
    pub kind: Kind,
    pub hits: Vec<usize>,
}

/// `hits` is ranked over all kinds (best first, the same order every time for the same data); `groups` lists the kinds in the order of their
/// best hit, so the first group holds `hits[0]`.
#[derive(Clone, PartialEq, Debug, Default)]
pub struct Results {
    pub hits: Vec<Hit>,
    pub groups: Vec<KindGroup>,
}

impl Results {
    pub fn is_empty(&self) -> bool {
        self.hits.is_empty()
    }

    pub fn len(&self) -> usize {
        self.hits.len()
    }

    pub(crate) fn from_ranked(hits: Vec<Hit>) -> Results {
        let mut groups: Vec<KindGroup> = Vec::new();
        for (i, hit) in hits.iter().enumerate() {
            match groups.iter_mut().find(|g| g.kind == hit.kind) {
                Some(group) => group.hits.push(i),
                None => groups.push(KindGroup { kind: hit.kind, hits: vec![i] }),
            }
        }
        Results { hits, groups }
    }
}

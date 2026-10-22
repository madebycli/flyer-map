//! The index the bar searches, and how it is kept up to date. Two kinds of content with different rhythms: the *world* (Gebiete, Gruppen, people, commands) is
//! small and changes when somebody is added or the rights change, so a change is applied entry by entry; the *field* (streets and houses, tens of thousands)
//! changes only when the map data is loaded again, so it is built in one go. Pure.
use flyermap_search::{Entry, Id, Index};
use std::collections::HashMap;

/// What to take out and what to put in so that `old` becomes `new`: entries that are gone, entries that are new or changed.
pub fn diff(old: &[Entry], new: &[Entry]) -> (Vec<Id>, Vec<Entry>) {
    let before: HashMap<&Id, &Entry> = old.iter().map(|e| (e.id(), e)).collect();
    let after: HashMap<&Id, &Entry> = new.iter().map(|e| (e.id(), e)).collect();
    let mut gone: Vec<Id> = before.keys().filter(|id| !after.contains_key(*id)).map(|id| (*id).clone()).collect();
    gone.sort();
    let mut put = Vec::new();
    for entry in new {
        if before.get(entry.id()).is_none_or(|known| **known != *entry) {
            put.push(entry.clone());
        }
    }
    (gone, put)
}

pub struct SearchStore {
    index: Index,
    /// The world's entries as they are in the index now.
    world: Vec<Entry>,
}

impl Default for SearchStore {
    fn default() -> SearchStore {
        SearchStore { index: Index::new(), world: Vec::new() }
    }
}

impl SearchStore {
    pub fn index(&self) -> &Index {
        &self.index
    }

    /// Make the world's part of the index `entries`. Returns whether anything changed (nothing: the index is left alone, so a poll that brings no news costs nothing).
    pub fn set_world(&mut self, entries: Vec<Entry>) -> bool {
        let (gone, put) = diff(&self.world, &entries);
        if gone.is_empty() && put.is_empty() {
            return false;
        }
        for id in &gone {
            self.index.remove(id);
        }
        for entry in put {
            // an id that is in the index already is replaced; one that is not is added
            let _ = if self.index.contains(entry.id()) { self.index.update(entry) } else { self.index.insert(entry) };
        }
        self.world = entries;
        true
    }

    /// The pieces (entry ids "s:<piece>") of the street with this name, if it is in the index.
    pub fn street_pieces(&self, name: &str) -> Vec<Id> {
        match self.index.get(&Id::from(format!("s:{name}"))) {
            Some(Entry::Street(street)) => street.pieces,
            _ => Vec::new(),
        }
    }

    /// Replace the field's part (streets and houses) by `entries`; the world's part stays.
    pub fn set_field(&mut self, entries: Vec<Entry>) {
        self.index = Index::build(self.world.iter().cloned().chain(entries));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_search::{Group, Point, Query, Street};

    fn group(id: &str, name: &str) -> Entry {
        Entry::Group(Group { id: Id::new(id), name: name.into() })
    }

    fn street(name: &str) -> Entry {
        Entry::Street(Street {
            id: Id::from(format!("s:{name}")),
            name: name.into(),
            pieces: vec![Id::from(format!("s:{name}#0"))],
            center: Point::new(13.0, 51.0),
            area: None,
        })
    }

    fn found(store: &SearchStore, text: &str) -> usize {
        store.index().search(&Query::new(text)).len()
    }

    #[test]
    fn the_diff_names_what_is_gone_new_and_changed_and_leaves_the_rest() {
        let old = vec![group("g:1", "Nord"), group("g:2", "Süd"), group("g:3", "Ost")];
        let new = vec![group("g:1", "Nord"), group("g:2", "Südwest"), group("g:4", "West")];
        let (gone, put) = diff(&old, &new);
        assert_eq!(gone, [Id::new("g:3")]);
        assert_eq!(put.iter().map(|e| e.id().as_str()).collect::<Vec<_>>(), ["g:2", "g:4"]);
        assert_eq!(diff(&new, &new), (Vec::new(), Vec::new()));
    }

    #[test]
    fn a_change_of_the_world_reaches_the_index_and_no_change_does_nothing() {
        let mut s = SearchStore::default();
        assert!(s.set_world(vec![group("g:1", "Nordgruppe")]));
        assert_eq!(found(&s, "nordgruppe"), 1);
        assert!(!s.set_world(vec![group("g:1", "Nordgruppe")]), "the same world is not applied again");
        assert!(s.set_world(vec![group("g:1", "Westgruppe")]));
        assert_eq!((found(&s, "nordgruppe"), found(&s, "westgruppe")), (0, 1));
        assert!(s.set_world(Vec::new()));
        assert_eq!(found(&s, "westgruppe"), 0);
    }

    #[test]
    fn loading_the_field_keeps_the_world_and_a_second_load_replaces_the_first() {
        let mut s = SearchStore::default();
        s.set_world(vec![group("g:1", "Nordgruppe")]);
        s.set_field(vec![street("Hauptstraße")]);
        assert_eq!((found(&s, "nordgruppe"), found(&s, "hauptstrasse")), (1, 1));
        assert_eq!(s.street_pieces("Hauptstraße"), [Id::new("s:Hauptstraße#0")]);
        assert!(s.street_pieces("Nirgends").is_empty());
        s.set_field(vec![street("Bahnhofstraße")]);
        assert_eq!((found(&s, "nordgruppe"), found(&s, "hauptstrasse"), found(&s, "bahnhof")), (1, 0, 1));
        // the world is still maintained entry by entry after a build
        s.set_world(vec![group("g:1", "Nordgruppe"), group("g:2", "Ostgruppe")]);
        assert_eq!(found(&s, "ostgruppe"), 1);
    }
}

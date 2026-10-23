//! The index: entries in slots, grouped under labels (one label per distinct title text), words pointing at labels.
//!
//! - A **slot** is one entry in compact form. Its title lives in its **label**; all houses of a street share the street's label, so a
//!   street name is folded, split and indexed once however many houses it has, and a query finds the street first and its houses after.
//! - A **label** knows its words (the title's, then extra words that find it: the kind, a command's keywords), its non-house members and
//!   its houses sorted by number.
//! - The **vocabulary** maps words to labels.
//!
//! Searching reads all of it; inserting, updating and removing touch one slot, its label and the words of that label.
mod build;
mod memory;
mod restore;
mod store;

use crate::{
    entry::{Art, Entry, Kind},
    error::EntryError,
    id::{Id, Point},
    text::HouseNo,
    vocab::Vocab,
};
use rustc_hash::FxHashMap;
use std::sync::Arc;

pub use memory::Memory;

/// Labels are shared by entries of the same class and title; houses and streets share theirs.
pub(crate) const CLASSES: usize = 7;

pub(crate) enum Data {
    Street { pieces: Box<[Id]> },
    House { no: HouseNo, raw: Option<Box<str>> },
    Area { art: Art },
    Group,
    Person,
    Note { key: Box<str> },
    Command { keywords: Box<[Box<str>]>, allowed: bool, priority: u8 },
}

impl Data {
    pub fn kind(&self) -> Kind {
        match self {
            Data::Street { .. } => Kind::Street,
            Data::House { .. } => Kind::House,
            Data::Area { .. } => Kind::Area,
            Data::Group => Kind::Group,
            Data::Person => Kind::Person,
            Data::Note { .. } => Kind::Note,
            Data::Command { .. } => Kind::Command,
        }
    }
}

pub(crate) struct Slot {
    pub id: Id,
    pub label: u32,
    pub pos: Option<Point>,
    /// 0 = none, else the index into `Index::areas` plus one.
    pub area: u32,
    pub data: Data,
}

pub(crate) struct Label {
    pub class: u8,
    /// What labels are looked up by: the title, or for a command its id (every command has a label of its own).
    pub key: Arc<str>,
    pub title: Arc<str>,
    /// Word ids: the first `n_title` are the title's (in reading order), the rest are extra words that find the entry.
    pub words: Vec<u32>,
    pub n_title: u16,
    pub members: Vec<u32>,
    /// `(number, slot)` of the houses, sorted.
    pub houses: Vec<(u32, u32)>,
}

pub struct Index {
    pub(crate) slots: Vec<Option<Slot>>,
    free_slots: Vec<u32>,
    pub(crate) by_id: FxHashMap<Id, u32>,
    pub(crate) labels: Vec<Option<Label>>,
    free_labels: Vec<u32>,
    by_key: [FxHashMap<Arc<str>, u32>; CLASSES],
    pub(crate) vocab: Vocab,
    areas: Vec<Id>,
    area_numbers: FxHashMap<Id, u32>,
    rejected: usize,
}

impl Default for Index {
    fn default() -> Index {
        Index::new()
    }
}

impl Index {
    pub fn new() -> Index {
        Index {
            slots: Vec::new(),
            free_slots: Vec::new(),
            by_id: FxHashMap::default(),
            labels: Vec::new(),
            free_labels: Vec::new(),
            by_key: Default::default(),
            vocab: Vocab::new(),
            areas: Vec::new(),
            area_numbers: FxHashMap::default(),
            rejected: 0,
        }
    }

    /// Everything in one go (faster than inserting one by one). An entry that cannot be indexed is left out and counted in `rejected`;
    /// of two entries with one id the later wins.
    pub fn build(entries: impl IntoIterator<Item = Entry>) -> Index {
        let mut index = Index::new();
        index.vocab.begin_bulk();
        for entry in entries {
            if index.upsert(entry).is_err() {
                index.rejected += 1;
            }
        }
        index.vocab.end_bulk();
        index
    }

    /// How many entries `build` had to leave out (empty id, nothing to search in, a house without street or number).
    pub fn rejected(&self) -> usize {
        self.rejected
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    pub fn contains(&self, id: &Id) -> bool {
        self.by_id.contains_key(id)
    }

    /// The entry as it was put in.
    pub fn get(&self, id: &Id) -> Option<Entry> {
        self.by_id.get(id).map(|&slot| self.entry_at(slot))
    }

    /// Add an entry whose id is new.
    pub fn insert(&mut self, entry: Entry) -> Result<(), EntryError> {
        if self.by_id.contains_key(entry.id()) {
            return Err(EntryError::Exists);
        }
        self.upsert(entry)
    }

    /// Replace the entry that has this id.
    pub fn update(&mut self, entry: Entry) -> Result<(), EntryError> {
        if !self.by_id.contains_key(entry.id()) {
            return Err(EntryError::Missing);
        }
        self.upsert(entry)
    }

    /// Take an entry out; it is returned as it was.
    pub fn remove(&mut self, id: &Id) -> Option<Entry> {
        let slot = *self.by_id.get(id)?;
        let entry = self.entry_at(slot);
        self.unplace(slot);
        Some(entry)
    }
}

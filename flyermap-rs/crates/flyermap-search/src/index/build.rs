//! From an entry to its place in the index: check it, split it into what its label needs and what its slot keeps, and place it.
use super::{Data, Index};
use crate::{
    entry::{Art, Entry},
    error::EntryError,
    german,
    id::{Id, Point},
    text::{fold_into, words, HouseNo, UNPARSED},
};

// The classes of labels: houses and streets share one (a street's houses hang on the street's label); a Gebiet has one per Art because
// its extra words differ.
pub(super) const STREET: u8 = 0;
pub(super) const GROUP: u8 = 3;
pub(super) const PERSON: u8 = 4;
pub(super) const NOTE: u8 = 5;
pub(super) const COMMAND: u8 = 6;

fn area_class(art: Art) -> u8 {
    match art {
        Art::Austeilen => 1,
        Art::Abholen => 2,
    }
}

/// An entry that passed the checks.
struct Prepared {
    id: Id,
    class: u8,
    /// What the label is looked up by (the title; a command's id).
    key: String,
    title: String,
    extras: Vec<String>,
    pos: Option<Point>,
    area: Option<Id>,
    data: Data,
}

fn has_words(text: &str) -> bool {
    let mut folded = Vec::new();
    fold_into(text, &mut folded);
    !words(&folded).is_empty()
}

fn prepare(entry: Entry) -> Result<Prepared, EntryError> {
    if entry.id().as_str().is_empty() {
        return Err(EntryError::EmptyId);
    }
    let plain = |id: Id, class: u8, title: String, extras: Vec<String>, pos: Option<Point>, area: Option<Id>, data: Data| {
        if has_words(&title) {
            Ok(Prepared { id, class, key: title.clone(), title, extras, pos, area, data })
        } else {
            Err(EntryError::NoText)
        }
    };
    match entry {
        Entry::Street(e) => plain(e.id, STREET, e.name, Vec::new(), Some(e.center), e.area, Data::Street { pieces: e.pieces.into() }),
        Entry::House(e) => {
            if e.number.trim().is_empty() || !has_words(&e.street) {
                return Err(EntryError::IncompleteHouse);
            }
            let (no, raw) = match HouseNo::parse(&e.number) {
                Some(no) if no.format() == e.number => (no, None),
                Some(no) => (no, Some(e.number.as_str().into())),
                None => (UNPARSED, Some(e.number.as_str().into())),
            };
            plain(e.id, STREET, e.street, Vec::new(), Some(e.position), e.area, Data::House { no, raw })
        }
        Entry::Area(e) => {
            let extras = vec![german::TAG_AREA.to_string(), german::art_name(e.art).to_string()];
            plain(e.id, area_class(e.art), e.name, extras, e.center, None, Data::Area { art: e.art })
        }
        Entry::Group(e) => plain(e.id, GROUP, e.name, vec![german::TAG_GROUP.to_string()], None, None, Data::Group),
        Entry::Person(e) => plain(e.id, PERSON, e.name, vec![german::TAG_PERSON.to_string()], None, None, Data::Person),
        Entry::Note(e) => plain(e.id, NOTE, e.text, vec![german::TAG_NOTE.to_string()], e.position, e.area, Data::Note { key: e.key.into() }),
        Entry::Command(e) => {
            let data = Data::Command { keywords: e.keywords.iter().map(|k| k.as_str().into()).collect(), allowed: e.allowed, priority: e.priority };
            let mut prepared = plain(e.id, COMMAND, e.label, e.keywords, None, None, data)?;
            prepared.key = prepared.id.as_str().to_string();
            Ok(prepared)
        }
    }
}

impl Index {
    /// Put the entry in; an entry with the same id is replaced. Nothing changes when the entry is refused.
    pub(super) fn upsert(&mut self, entry: Entry) -> Result<(), EntryError> {
        let p = prepare(entry)?;
        if let Some(&slot) = self.by_id.get(&p.id) {
            self.unplace(slot);
        }
        let label = self.label_for(p.class, &p.key, &p.title, &p.extras);
        let area = self.area_number(p.area.as_ref());
        let house = match &p.data {
            Data::House { no, .. } => Some(no.lo.0),
            _ => None,
        };
        let slot = self.alloc_slot();
        self.by_id.insert(p.id.clone(), slot);
        self.slots[slot as usize] = Some(super::Slot { id: p.id, label, pos: p.pos, area, data: p.data });
        if let Some(Some(l)) = self.labels.get_mut(label as usize) {
            match house {
                Some(base) => {
                    let at = l.houses.partition_point(|&h| h < (base, slot));
                    l.houses.insert(at, (base, slot));
                }
                None => l.members.push(slot),
            }
        }
        Ok(())
    }
}

//! From a slot back to the entry the host put in.
use super::{Data, Index, Slot};
use crate::{
    entry::{Area, Command, Entry, Group, House, Note, Person, Street},
    id::Point,
};

impl Index {
    /// The slot must be live (callers hold slot numbers they found in the index).
    pub(crate) fn slot(&self, slot: u32) -> &Slot {
        self.slots[slot as usize].as_ref().expect("a slot number found in the index is live")
    }

    /// The street name, the text of a note, the name of a Gebiet: the title without the house number.
    pub(crate) fn label_title(&self, slot: &Slot) -> &str {
        self.labels[slot.label as usize].as_ref().map_or("", |l| &l.title)
    }

    pub(crate) fn entry_at(&self, slot: u32) -> Entry {
        let s = self.slot(slot);
        let id = s.id.clone();
        let title = self.label_title(s).to_string();
        let area = self.area_id(s.area).cloned();
        match &s.data {
            Data::Street { pieces } => Entry::Street(Street { id, name: title, pieces: pieces.to_vec(), center: s.pos.unwrap_or(Point::new(0.0, 0.0)), area }),
            Data::House { no, raw } => {
                let number = raw.as_ref().map_or_else(|| no.format(), |r| r.to_string());
                Entry::House(House { id, street: title, number, position: s.pos.unwrap_or(Point::new(0.0, 0.0)), area })
            }
            Data::Area { art } => Entry::Area(Area { id, name: title, art: *art, center: s.pos }),
            Data::Group => Entry::Group(Group { id, name: title }),
            Data::Person => Entry::Person(Person { id, name: title }),
            Data::Note { key } => Entry::Note(Note { id, text: title, key: key.to_string(), position: s.pos, area }),
            Data::Command { keywords, allowed, priority } => {
                Entry::Command(Command { id, label: title, keywords: keywords.iter().map(|k| k.to_string()).collect(), allowed: *allowed, priority: *priority })
            }
        }
    }
}

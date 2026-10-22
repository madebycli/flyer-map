//! How much memory the index holds, counted from the capacities of what it owns (the allocator's own overhead is not in it).
use super::{Data, Index, Label, Slot};
use crate::id::Id;
use std::mem::size_of;

/// Bytes, by part.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Memory {
    /// The entries: slots, ids, positions, numbers, notes, street pieces.
    pub entries: usize,
    /// The shared titles with their word lists and member lists.
    pub labels: usize,
    /// The vocabulary: word text, order, postings.
    pub vocabulary: usize,
    /// The id → slot table and the title → label tables.
    pub lookup: usize,
}

impl Memory {
    pub fn total(&self) -> usize {
        self.entries + self.labels + self.vocabulary + self.lookup
    }
}

/// An `Arc<str>` allocation: two counters and the text.
fn shared_text(text: &str) -> usize {
    2 * size_of::<usize>() + text.len()
}

fn slot_bytes(slot: &Slot) -> usize {
    let own = shared_text(slot.id.as_str());
    own + match &slot.data {
        Data::Street { pieces } => pieces.len() * size_of::<Id>() + pieces.iter().map(|p| shared_text(p.as_str())).sum::<usize>(),
        Data::House { raw, .. } => raw.as_ref().map_or(0, |r| r.len()),
        Data::Note { key } => key.len(),
        Data::Command { keywords, .. } => keywords.iter().map(|k| size_of::<Box<str>>() + k.len()).sum(),
        Data::Area { .. } | Data::Group | Data::Person => 0,
    }
}

fn label_bytes(label: &Label) -> usize {
    let key = if label.class == 6 { shared_text(&label.key) } else { 0 };
    size_of::<Label>() + shared_text(&label.title) + key + label.words.capacity() * 4 + label.members.capacity() * 4 + label.houses.capacity() * 8
}

impl Index {
    pub fn memory(&self) -> Memory {
        let entries = self.slots.capacity() * size_of::<Option<Slot>>() + self.slots.iter().flatten().map(slot_bytes).sum::<usize>();
        let labels = self.labels.capacity() * size_of::<Option<Label>>() + self.labels.iter().flatten().map(label_bytes).sum::<usize>();
        let by_key: usize = self.by_key.iter().map(|m| m.capacity() * (size_of::<(std::sync::Arc<str>, u32)>() + 1)).sum();
        let lookup = self.by_id.capacity() * (size_of::<(Id, u32)>() + 1) + by_key;
        Memory { entries, labels, vocabulary: self.vocab.bytes(), lookup }
    }
}

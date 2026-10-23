//! Slots and labels: where entries and their shared titles live, and how they are taken out again.
use super::{build::COMMAND, Data, Index, Label};
use crate::{
    id::Id,
    text::{fold_into, words},
};
use std::sync::Arc;

impl Index {
    pub(super) fn alloc_slot(&mut self) -> u32 {
        match self.free_slots.pop() {
            Some(slot) => slot,
            None => {
                self.slots.push(None);
                (self.slots.len() - 1) as u32
            }
        }
    }

    /// 0 for none, else a small number standing for the Gebiet id (ids are interned: a house carries four bytes, not a string).
    pub(super) fn area_number(&mut self, id: Option<&Id>) -> u32 {
        let Some(id) = id else {
            return 0;
        };
        if let Some(&number) = self.area_numbers.get(id) {
            return number;
        }
        self.areas.push(id.clone());
        let number = self.areas.len() as u32;
        self.area_numbers.insert(id.clone(), number);
        number
    }

    pub(crate) fn area_id(&self, number: u32) -> Option<&Id> {
        number.checked_sub(1).and_then(|i| self.areas.get(i as usize))
    }

    /// The number a Gebiet id stands for, if any entry lies in that Gebiet.
    pub(crate) fn area_number_of(&self, id: &Id) -> u32 {
        self.area_numbers.get(id).copied().unwrap_or(0)
    }

    /// The label for this class and key; made (words interned and attached) when it is new. The title must have words (checked by `prepare`).
    pub(super) fn label_for(&mut self, class: u8, key: &str, title: &str, extras: &[String]) -> u32 {
        if let Some(&label) = self.by_key[class as usize].get(key) {
            return label;
        }
        let mut folded = Vec::new();
        fold_into(title, &mut folded);
        let mut ids: Vec<u32> = words(&folded).iter().map(|w| self.vocab.intern(&w.text)).collect();
        let n_title = ids.len() as u16;
        for extra in extras {
            fold_into(extra, &mut folded);
            ids.extend(words(&folded).iter().map(|w| self.vocab.intern(&w.text)));
        }
        let at = self.free_labels.pop().unwrap_or(self.labels.len() as u32);
        for &word in &ids {
            self.vocab.attach(word, at);
        }
        let title: Arc<str> = Arc::from(title);
        let key: Arc<str> = if class == COMMAND { Arc::from(key) } else { title.clone() };
        let label = Label { class, key: key.clone(), title, words: ids, n_title, members: Vec::new(), houses: Vec::new() };
        if at as usize == self.labels.len() {
            self.labels.push(Some(label));
        } else {
            self.labels[at as usize] = Some(label);
        }
        self.by_key[class as usize].insert(key, at);
        at
    }

    /// Take the slot out of the index; its label goes with it when it was the last entry under it.
    pub(super) fn unplace(&mut self, slot: u32) {
        let Some(old) = self.slots.get_mut(slot as usize).and_then(Option::take) else {
            return;
        };
        self.free_slots.push(slot);
        self.by_id.remove(&old.id);
        let Some(Some(label)) = self.labels.get_mut(old.label as usize) else {
            return;
        };
        match old.data {
            Data::House { no, .. } => {
                let at = label.houses.partition_point(|&h| h < (no.lo.0, slot));
                if label.houses.get(at) == Some(&(no.lo.0, slot)) {
                    label.houses.remove(at);
                }
            }
            _ => {
                if let Some(at) = label.members.iter().position(|&m| m == slot) {
                    label.members.swap_remove(at);
                }
            }
        }
        if label.members.is_empty() && label.houses.is_empty() {
            self.drop_label(old.label);
        }
    }

    fn drop_label(&mut self, at: u32) {
        let Some(label) = self.labels.get_mut(at as usize).and_then(Option::take) else {
            return;
        };
        let mut words = label.words;
        words.sort_unstable();
        words.dedup();
        for word in words {
            self.vocab.detach(word, at);
        }
        self.by_key[label.class as usize].remove(&*label.key);
        self.free_labels.push(at);
    }
}

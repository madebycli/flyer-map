//! Notes ride the sync loop as its side channel. This milestone only reads them (writing and the notes screens come with M6): newest wins
//! by `rev`, deleted ones leave, and the menu shows how many there are.
use flyermap_core::note::Note;
use std::collections::HashMap;

#[derive(Default)]
pub struct Notes {
    by_id: HashMap<String, Note>,
    pub cursor: u64,
}

impl Notes {
    pub fn receive(&mut self, notes: Vec<Note>, cursor: u64) {
        for note in notes {
            let newer = self.by_id.get(&note.id).is_none_or(|known| note.rev > known.rev);
            if !newer {
                continue;
            }
            if note.deleted {
                self.by_id.remove(&note.id);
            } else {
                self.by_id.insert(note.id.clone(), note);
            }
        }
        self.cursor = self.cursor.max(cursor);
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, rev: &str, deleted: bool) -> Note {
        serde_json::from_value(serde_json::json!({"id": id, "key": "h:1", "area": "a", "flag": null, "text": "", "rev": rev, "deleted": deleted, "by": "x"}))
            .unwrap()
    }

    #[test]
    fn the_newest_revision_wins_and_deleted_notes_leave() {
        let mut n = Notes::default();
        n.receive(vec![note("1", "b", false), note("2", "a", false)], 4);
        n.receive(vec![note("1", "a", true)], 2);
        assert_eq!((n.len(), n.cursor), (2, 4), "an older deletion does not remove, the cursor never goes back");
        n.receive(vec![note("1", "c", true)], 5);
        assert_eq!(n.len(), 1);
    }
}

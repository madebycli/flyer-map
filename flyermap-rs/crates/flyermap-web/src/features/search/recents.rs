//! What was picked lately, kept per Aktion on this device (the ids mean something only there) and handed to the search, which offers it again while the field is
//! empty and ranks it higher when something is typed. Pure: the list and its text form; the host reads and writes the storage.
use flyermap_search::{Id, Recent};
use serde::{Deserialize, Serialize};

/// How many are kept.
pub const KEEP: usize = 20;

/// The key of an Aktion's recents in the storage.
pub fn key(aktion: &str) -> String {
    format!("fm-recents:{aktion}")
}

#[derive(Serialize, Deserialize)]
struct Saved {
    id: String,
    at: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Recents(Vec<(String, u64)>);

impl Recents {
    /// A thing picked again moves to the front; only the newest `KEEP` stay.
    pub fn push(&mut self, id: &str, at: u64) {
        self.0.retain(|(known, _)| known != id);
        self.0.insert(0, (id.to_string(), at));
        self.0.truncate(KEEP);
    }

    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(id, _)| id.as_str())
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// For the search's context.
    pub fn for_search(&self) -> Vec<Recent> {
        self.0.iter().map(|(id, at)| Recent { id: Id::new(id), at: *at }).collect()
    }

    pub fn to_text(&self) -> String {
        let saved: Vec<Saved> = self.0.iter().map(|(id, at)| Saved { id: id.clone(), at: *at }).collect();
        serde_json::to_string(&saved).unwrap_or_default()
    }

    /// Reads what `to_text` wrote; anything else (nothing, damage) gives fewer or no entries, never an error. Newest first.
    pub fn from_text(text: Option<&str>) -> Recents {
        let mut saved: Vec<Saved> = text.and_then(|t| serde_json::from_str(t).ok()).unwrap_or_default();
        saved.sort_by_key(|s| std::cmp::Reverse(s.at));
        saved.truncate(KEEP);
        Recents(saved.into_iter().map(|s| (s.id, s.at)).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_newest_comes_first_and_a_repeat_moves_up() {
        let mut r = Recents::default();
        for (i, id) in ["a:1", "a:2", "h:3"].iter().enumerate() {
            r.push(id, i as u64);
        }
        r.push("a:1", 9);
        assert_eq!(r.ids().collect::<Vec<_>>(), ["a:1", "h:3", "a:2"]);
        assert_eq!(r.for_search()[0], Recent { id: Id::new("a:1"), at: 9 });
    }

    #[test]
    fn only_so_many_are_kept() {
        let mut r = Recents::default();
        for i in 0..(KEEP as u64 + 5) {
            r.push(&format!("h:{i}"), i);
        }
        assert_eq!(r.len(), KEEP);
        assert_eq!(r.ids().next(), Some("h:24"));
    }

    #[test]
    fn the_text_form_reads_back_and_damage_is_forgiven() {
        let mut r = Recents::default();
        r.push("s:Hauptstraße", 5);
        r.push("p:1", 7);
        assert_eq!(Recents::from_text(Some(&r.to_text())), r);
        assert!(Recents::from_text(Some("not json")).is_empty());
        assert!(Recents::from_text(None).is_empty());
        assert!(Recents::from_text(Some("[{\"id\":1}]")).is_empty());
    }
}

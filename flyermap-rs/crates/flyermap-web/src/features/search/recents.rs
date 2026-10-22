//! What was picked lately, offered again while the field is empty: the quickest way back to the street a person works on. Per Aktion on this device
//! (the ids mean something only there). Pure: the list and its text form; the host reads and writes the storage.
use crate::ui::{Hit, HitKind};
use serde::{Deserialize, Serialize};

/// How many are kept.
pub const KEEP: usize = 6;

/// The key of an Aktion's recents in the storage.
pub fn key(aktion: &str) -> String {
    format!("fm-recents:{aktion}")
}

#[derive(Serialize, Deserialize)]
struct Saved {
    k: String,
    id: String,
    label: String,
    detail: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Recents(Vec<Hit>);

impl Recents {
    /// Newest first; a thing picked again moves to the front. Commands are never remembered (they are on offer anyway).
    pub fn push(&mut self, hit: &Hit) {
        if hit.kind == HitKind::Command {
            return;
        }
        self.0.retain(|h| !(h.kind == hit.kind && h.id == hit.id));
        self.0.insert(0, Hit { marks: Vec::new(), ..hit.clone() });
        self.0.truncate(KEEP);
    }

    /// Drop what is gone (a Gebiet that was removed, a Lauf that ended).
    pub fn retain(&mut self, keep: impl Fn(&Hit) -> bool) {
        self.0.retain(keep);
    }

    pub fn hits(&self) -> &[Hit] {
        &self.0
    }

    pub fn to_text(&self) -> String {
        let saved: Vec<Saved> =
            self.0.iter().map(|h| Saved { k: h.kind.code().into(), id: h.id.clone(), label: h.label.clone(), detail: h.detail.clone() }).collect();
        serde_json::to_string(&saved).unwrap_or_default()
    }

    /// Reads what `to_text` wrote; anything else (nothing, damage, an unknown kind) gives fewer or no entries, never an error.
    pub fn from_text(text: Option<&str>) -> Recents {
        let saved: Vec<Saved> = text.and_then(|t| serde_json::from_str(t).ok()).unwrap_or_default();
        let hits = saved
            .into_iter()
            .filter_map(|s| {
                let kind = HitKind::from_code(&s.k).filter(|k| *k != HitKind::Command)?;
                Some(Hit { id: s.id, kind, label: s.label, detail: s.detail, icon: None, marks: Vec::new() })
            })
            .take(KEEP)
            .collect();
        Recents(hits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(kind: HitKind, id: &str) -> Hit {
        Hit { id: id.into(), kind, label: format!("label {id}"), detail: "d".into(), icon: None, marks: vec![(0, 2)] }
    }

    #[test]
    fn the_newest_comes_first_and_a_repeat_moves_up() {
        let mut r = Recents::default();
        for id in ["a", "b", "c"] {
            r.push(&hit(HitKind::Gebiet, id));
        }
        r.push(&hit(HitKind::Gebiet, "a"));
        assert_eq!(r.hits().iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), ["a", "c", "b"]);
        assert!(r.hits()[0].marks.is_empty(), "marks belong to the text that was typed, not to the thing");
    }

    #[test]
    fn the_same_id_of_another_kind_is_another_thing() {
        let mut r = Recents::default();
        r.push(&hit(HitKind::Gebiet, "x"));
        r.push(&hit(HitKind::Gruppe, "x"));
        assert_eq!(r.hits().len(), 2);
    }

    #[test]
    fn only_so_many_are_kept_and_commands_are_not() {
        let mut r = Recents::default();
        for i in 0..10 {
            r.push(&hit(HitKind::House, &format!("h{i}")));
        }
        r.push(&hit(HitKind::Command, "help"));
        assert_eq!(r.hits().len(), KEEP);
        assert_eq!(r.hits()[0].id, "h9");
    }

    #[test]
    fn the_text_form_reads_back_and_damage_is_forgiven() {
        let mut r = Recents::default();
        r.push(&hit(HitKind::Street, "s1"));
        r.push(&hit(HitKind::Person, "p1"));
        assert_eq!(Recents::from_text(Some(&r.to_text())), r);
        assert_eq!(Recents::from_text(Some("not json")), Recents::default());
        assert_eq!(Recents::from_text(None), Recents::default());
        let odd = r#"[{"k":"command","id":"x","label":"l","detail":""},{"k":"spaceship","id":"y","label":"l","detail":""},{"k":"lauf","id":"z","label":"l","detail":""}]"#;
        assert_eq!(Recents::from_text(Some(odd)).hits().iter().map(|h| h.id.as_str()).collect::<Vec<_>>(), ["z"]);
    }

    #[test]
    fn what_is_gone_can_be_dropped() {
        let mut r = Recents::default();
        r.push(&hit(HitKind::Gebiet, "a"));
        r.push(&hit(HitKind::Gebiet, "b"));
        r.retain(|h| h.id != "a");
        assert_eq!(r.hits().len(), 1);
    }
}

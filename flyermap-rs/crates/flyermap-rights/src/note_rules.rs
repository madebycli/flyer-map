//! What makes a batch of notes acceptable. Like [`crate::op_rules`]: one pure step per note, the database checks (who owns the key, is the note
//! already somewhere else) stay with the Worker and feed back through [`NoteScreened::refuse`].
use crate::op_rules::FUTURE_SKEW_MS;
use flyermap_core::{
    clock::decode_clock,
    note::{clean_text, is_note_key, Flag, NOTE_TEXT_MAX},
};
use std::collections::BTreeMap;

pub const MAX_NOTES: usize = 50;

/// What came in for `flag`: nothing (absent or null), a flag we know, or something else.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FlagField {
    None,
    Known(Flag),
    Invalid,
}

/// What came in for `text`: absent, a string, or something that is not a string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextField {
    Absent,
    Text(String),
    NotText,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RawNote {
    NotAnObject,
    Fields { id: Option<String>, key: Option<String>, area: Option<String>, flag: FlagField, text: TextField, rev: Option<String>, deleted: bool },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteReason {
    BadId,
    ClockFuture,
    BadKey,
    BadArea,
    BadFlag,
    BadText,
    Empty,
    AreaForbidden,
    KeyOwnedElsewhere,
    NoteImmutable,
}

impl NoteReason {
    pub fn as_str(self) -> &'static str {
        match self {
            NoteReason::BadId => "bad_id",
            NoteReason::ClockFuture => "clock_future",
            NoteReason::BadKey => "bad_key",
            NoteReason::BadArea => "bad_area",
            NoteReason::BadFlag => "bad_flag",
            NoteReason::BadText => "bad_text",
            NoteReason::Empty => "empty",
            NoteReason::AreaForbidden => "area_forbidden",
            NoteReason::KeyOwnedElsewhere => "key_owned_elsewhere",
            NoteReason::NoteImmutable => "note_immutable",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NoteWrite {
    pub id: String,
    pub key: String,
    pub area: String,
    pub flag: Option<Flag>,
    pub text: String,
    pub rev: String,
    pub deleted: bool,
}

#[derive(Debug, Default)]
pub struct NoteScreened {
    pub accepted: Vec<String>,
    pub rejected: Vec<(String, NoteReason)>,
    /// The newest edit per note id.
    pub latest: BTreeMap<String, NoteWrite>,
}

fn area_id_valid(id: &str) -> bool {
    (1..=160).contains(&id.chars().count()) && id.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
}

pub fn screen_notes(notes: &[RawNote], now: u64, mut area_writable: impl FnMut(&str) -> bool) -> NoteScreened {
    let mut out = NoteScreened::default();
    let mut area_ok: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    for note in notes {
        let RawNote::Fields { id, key, area, flag, text, rev, deleted } = note else {
            out.rejected.push((String::new(), NoteReason::BadId));
            continue;
        };
        let id = id.clone().unwrap_or_default();
        let mut reject = |reason| out.rejected.push((id.clone(), reason));
        let (Some(_), Some(edited), Some(rev)) = (decode_clock(&id), rev.as_deref().and_then(decode_clock), rev.as_deref()) else {
            reject(NoteReason::BadId);
            continue;
        };
        if rev < id.as_str() {
            reject(NoteReason::BadId);
            continue;
        }
        if edited.wall > now.saturating_add(FUTURE_SKEW_MS) {
            reject(NoteReason::ClockFuture);
            continue;
        }
        let Some(key) = key.as_deref().filter(|k| is_note_key(k)) else {
            reject(NoteReason::BadKey);
            continue;
        };
        let Some(area) = area.as_deref().filter(|a| area_id_valid(a)) else {
            reject(NoteReason::BadArea);
            continue;
        };
        if key.starts_with("a:") && key != format!("a:{area}") {
            reject(NoteReason::BadKey);
            continue;
        }
        let flag = match flag {
            FlagField::None => None,
            FlagField::Known(f) => Some(*f),
            FlagField::Invalid => {
                reject(NoteReason::BadFlag);
                continue;
            }
        };
        let raw_text = match text {
            TextField::Absent => "",
            TextField::Text(t) if t.encode_utf16().count() <= NOTE_TEXT_MAX * 2 => t.as_str(),
            _ => {
                reject(NoteReason::BadText);
                continue;
            }
        };
        let clean = clean_text(raw_text);
        if !deleted && flag.is_none() && clean.is_empty() {
            reject(NoteReason::Empty);
            continue;
        }
        if !*area_ok.entry(area.to_string()).or_insert_with(|| area_writable(area)) {
            reject(NoteReason::AreaForbidden);
            continue;
        }
        out.accepted.push(id.clone());
        if out.latest.get(&id).is_none_or(|prior| prior.rev.as_str() < rev) {
            out.latest
                .insert(id.clone(), NoteWrite { id, key: key.to_string(), area: area.to_string(), flag, text: clean, rev: rev.to_string(), deleted: *deleted });
        }
    }
    out
}

impl NoteScreened {
    /// A check against the database said no: the note is not written and the client is told why.
    pub fn refuse(&mut self, id: &str, reason: NoteReason) {
        if self.latest.remove(id).is_none() {
            return;
        }
        if let Some(i) = self.accepted.iter().position(|a| a == id) {
            self.accepted.remove(i);
        }
        self.rejected.push((id.to_string(), reason));
    }

    /// Oldest edit first (by rev, then id): the order the sequence numbers follow.
    pub fn writes_in_order(&self) -> Vec<&NoteWrite> {
        let mut rows: Vec<&NoteWrite> = self.latest.values().collect();
        rows.sort_by(|a, b| a.rev.cmp(&b.rev).then(a.id.cmp(&b.id)));
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_core::{encode_clock, ClockState};

    const NOW: u64 = 1_800_000_000_000;
    fn stamp(wall: u64) -> String {
        encode_clock(&ClockState { wall, counter: 0, node: "n".into() }).to_string()
    }
    fn note(id: &str, rev: &str, key: &str, area: &str, flag: FlagField, text: TextField) -> RawNote {
        RawNote::Fields { id: Some(id.into()), key: Some(key.into()), area: Some(area.into()), flag, text, rev: Some(rev.into()), deleted: false }
    }

    #[test]
    fn every_fault_has_its_reason() {
        let (a, b) = (stamp(NOW - 2000), stamp(NOW - 1000));
        let notes = vec![
            RawNote::NotAnObject,
            note(&b, &a, "h:1", "area_n", FlagField::None, TextField::Text("x".into())),
            note(&a, &stamp(NOW + FUTURE_SKEW_MS + 1), "h:1", "area_n", FlagField::None, TextField::Text("x".into())),
            note(&a, &b, "x:1", "area_n", FlagField::None, TextField::Text("x".into())),
            note(&a, &b, "h:1", "bad area", FlagField::None, TextField::Text("x".into())),
            note(&a, &b, "a:other", "area_n", FlagField::None, TextField::Text("x".into())),
            note(&a, &b, "h:1", "area_n", FlagField::Invalid, TextField::Text("x".into())),
            note(&a, &b, "h:1", "area_n", FlagField::None, TextField::NotText),
            note(&a, &b, "h:1", "area_n", FlagField::None, TextField::Text(" \u{7} ".into())),
            note(&a, &b, "h:1", "area_o", FlagField::Known(Flag::Dog), TextField::Absent),
            note(&a, &b, "a:area_n", "area_n", FlagField::Known(Flag::Info), TextField::Absent),
        ];
        let s = screen_notes(&notes, NOW, |area| area == "area_n");
        let reasons: Vec<&str> = s.rejected.iter().map(|(_, r)| r.as_str()).collect();
        assert_eq!(reasons, ["bad_id", "bad_id", "clock_future", "bad_key", "bad_area", "bad_key", "bad_flag", "bad_text", "empty", "area_forbidden"]);
        assert_eq!(s.accepted, [a]);
    }

    #[test]
    fn the_newest_edit_of_a_note_wins_and_a_refusal_takes_it_back() {
        let (id, r1, r2) = (stamp(NOW - 3000), stamp(NOW - 2000), stamp(NOW - 1000));
        let mut s = screen_notes(
            &[
                note(&id, &r2, "h:1", "area_n", FlagField::None, TextField::Text("new".into())),
                note(&id, &r1, "h:1", "area_n", FlagField::None, TextField::Text("old".into())),
            ],
            NOW,
            |_| true,
        );
        assert_eq!(s.latest[&id].text, "new");
        s.refuse(&id, NoteReason::NoteImmutable);
        assert!(s.latest.is_empty());
        assert_eq!(s.accepted.len(), 1, "only the first acceptance of the id is withdrawn, as before");
    }
}

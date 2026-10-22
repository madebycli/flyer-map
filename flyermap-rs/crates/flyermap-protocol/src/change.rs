//! The log. Every change of the state of an Aktion is one numbered [`Entry`]; the state is a function of the entries alone (replay). A device applies
//! the entries it is shown in log order and skips those at or below the position it has reached; it ends up with the state the server shows to its caller.
//! Marks and notes are last-writer-wins by stamp and the rest by revision, so applying the same entry twice, or an entry that is older than the state
//! (a page of marks that is newer than the snapshot), changes nothing; what is not stamped (`Collected`, `Released`) needs the log order.
//!
//! Every entry is about one Gebiet (or a Gruppe), so that "who is told" is one question about one thing. A hand-over between two Gebiete is therefore
//! two kinds of entry: the marks and notes arrive in the new Gebiet as `MarkSet` and `NoteSet`, and the old Gebiet is told what left it (`HandedOver`).
//! One limit is the host's: when the rights of a caller change (a grant ends, a Gebiet is given to another Gruppe) the entries that took something from
//! view are not shown to that caller; the host takes a new snapshot of it then (Plan 061 §3).
use crate::{
    ids::NoteId,
    model::{Gebiet, Gruppe, Lauf, Notiz},
};
use flyermap_core::{Key, OpId, Status};
use flyermap_identity::{GebietId, GruppeId};
use serde::{Deserialize, Serialize};

/// One thing that happened. State-carrying variants hold the whole new state of the thing they name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum Change {
    /// The winner of a race on `key`; the mark belongs to `gebiet`. Who made it is the `by` of the entry. The same stamp arriving again for another
    /// Gebiet is the key being handed over (`Move`): the newer or equal stamp wins, in the order of the log.
    MarkSet {
        gebiet: GebietId,
        key: Key,
        status: Status,
        op: OpId,
    },
    /// Marks cleaned away (tombstones stamped `rev` by the Akteur: an older edit that arrives later does not bring them back).
    MarksRemoved {
        gebiet: GebietId,
        keys: Vec<Key>,
        rev: OpId,
    },
    NoteSet {
        note: Notiz,
    },
    NotesRemoved {
        gebiet: GebietId,
        ids: Vec<NoteId>,
        rev: OpId,
    },
    /// Marks on `keys` and notes `notes` left `from` for the Gebiet `to` (`Move`). They arrive in `to` as `MarkSet` and `NoteSet`, which only those who
    /// read `to` are shown; this entry is for those who read `from`: they drop what is listed, if it is still `from`'s (a `MarkSet` for `to` may have
    /// reached them before or after). The tables are not touched by it.
    HandedOver {
        from: GebietId,
        to: GebietId,
        keys: Vec<Key>,
        notes: Vec<NoteId>,
    },
    GruppeSet {
        gruppe: Gruppe,
    },
    GruppeRemoved {
        id: GruppeId,
        rev: u64,
    },
    GebietSet {
        gebiet: Gebiet,
    },
    GebietRemoved {
        id: GebietId,
        rev: u64,
    },
    Collected {
        gebiet: GebietId,
        by: String,
        at: u64,
    },
    Released {
        gebiet: GebietId,
    },
    /// A Lauf was opened, changed or recounted.
    LaufSet {
        lauf: Lauf,
    },
    /// A Lauf ended (the whole final state). The owner of the grants ends the access of its guests on this.
    LaufEnded {
        lauf: Lauf,
    },
}

/// A numbered change. `seq` has no gaps: it is the position in the log and the cursor of every device.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub seq: u64,
    /// Server time, ms.
    pub at: u64,
    /// The principal that caused it (an opaque label, never a name).
    pub by: String,
    pub change: Change,
}

impl Change {
    /// A short stable name, for counters (no data in it).
    pub fn kind(&self) -> &'static str {
        match self {
            Change::MarkSet { .. } => "mark-set",
            Change::MarksRemoved { .. } => "marks-removed",
            Change::NoteSet { .. } => "note-set",
            Change::NotesRemoved { .. } => "notes-removed",
            Change::HandedOver { .. } => "handed-over",
            Change::GruppeSet { .. } => "gruppe-set",
            Change::GruppeRemoved { .. } => "gruppe-removed",
            Change::GebietSet { .. } => "gebiet-set",
            Change::GebietRemoved { .. } => "gebiet-removed",
            Change::Collected { .. } => "collected",
            Change::Released { .. } => "released",
            Change::LaufSet { .. } => "lauf-set",
            Change::LaufEnded { .. } => "lauf-ended",
        }
    }

    /// The Gebiet the change is about, when it is about one (rights are decided on it); `None` for Gruppen.
    pub fn gebiet(&self) -> Option<&GebietId> {
        match self {
            Change::MarkSet { gebiet, .. }
            | Change::MarksRemoved { gebiet, .. }
            | Change::NotesRemoved { gebiet, .. }
            | Change::HandedOver { from: gebiet, .. }
            | Change::Collected { gebiet, .. }
            | Change::Released { gebiet } => Some(gebiet),
            Change::NoteSet { note } => Some(&note.gebiet),
            Change::GebietSet { gebiet } => Some(&gebiet.id),
            Change::GebietRemoved { id, .. } => Some(id),
            Change::LaufSet { lauf } | Change::LaufEnded { lauf } => Some(&lauf.gebiet),
            Change::GruppeSet { .. } | Change::GruppeRemoved { .. } => None,
        }
    }
}

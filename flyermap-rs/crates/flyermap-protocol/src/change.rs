//! The log. Every change of the state of an Aktion is one numbered [`Entry`]; the state is a function of the entries alone (replay), and a device that
//! applies the entries it is shown, in any order and any number of times, ends up with the same state as the server (last writer wins on marks and
//! notes, the highest revision on the rest).
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

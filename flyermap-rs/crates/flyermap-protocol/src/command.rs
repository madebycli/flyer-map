//! What a device asks of the Akteur. Every command carries a [`CommandId`]: sent twice, it happens once. The `*In` structs are what a device says
//! about a thing; what the Akteur adds (who, when, the revision) is in `model`.
use crate::{
    ids::{CommandId, LaufId, NoteId},
    model::{Counts, Join, Ring},
};
use flyermap_core::{note::Flag, Key, OpId, Status};
use flyermap_identity::{Art, GebietId, GruppeId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Command {
    pub cid: CommandId,
    pub body: Body,
}

/// One edit of a mark: "this key has this status", stamped by the clock of the device (its id is also the position in the race).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarkIn {
    pub key: Key,
    pub status: Status,
    pub op: OpId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteIn {
    pub id: NoteId,
    pub key: Key,
    pub gebiet: GebietId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flag: Option<Flag>,
    pub text: String,
    /// The stamp of this edit; the newest wins. A note is deleted by sending it again with `deleted` and a newer stamp.
    pub rev: OpId,
    #[serde(default)]
    pub deleted: bool,
}

/// Create (`base_rev` 0) or change (`base_rev` is the revision the edit was made on) a Gruppe.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GruppeIn {
    pub id: GruppeId,
    pub name: String,
    pub color: u8,
    pub base_rev: u64,
}

/// Create (`base_rev` 0) or change a Gebiet. Its world (`art`) never changes after creation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GebietIn {
    pub id: GebietId,
    pub art: Art,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gruppe: Option<GruppeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<GebietId>,
    pub name: String,
    pub ring: Ring,
    pub base_rev: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LaufIn {
    pub id: LaufId,
    pub gebiet: GebietId,
    pub persons: u16,
    pub join: Join,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum Body {
    /// Edits of marks in one Gebiet. The right to mark is decided once for the Gebiet; each mark is judged on its own.
    Marks {
        gebiet: GebietId,
        marks: Vec<MarkIn>,
    },
    /// Write or delete a note.
    Note {
        note: NoteIn,
    },
    Gruppe {
        gruppe: GruppeIn,
    },
    GruppeRemove {
        id: GruppeId,
        base_rev: u64,
    },
    Gebiet {
        gebiet: GebietIn,
    },
    /// Delete a Gebiet. Its marks and notes stay as orphans (counted in the answer) until a `Cleanup` removes them.
    GebietRemove {
        id: GebietId,
        base_rev: u64,
    },
    /// Take a free Gebiet over (Abholen).
    Collect {
        gebiet: GebietId,
    },
    /// Give a Gebiet back: the one who took it, or an Admin.
    Release {
        gebiet: GebietId,
    },
    RunStart {
        run: LaufIn,
    },
    /// Change what is counted by hand (`persons`) or who may join; what is absent stays.
    RunUpdate {
        id: LaufId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        persons: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        join: Option<Join>,
    },
    RunEnd {
        id: LaufId,
    },
    /// Remove marks and notes of a Gebiet for good (tombstones remain). Without `keys`: every orphan of a deleted Gebiet; with `keys`: those of a
    /// live or deleted Gebiet. `expect` must equal what would be removed: the person has seen the numbers and agreed to them.
    Cleanup {
        gebiet: GebietId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        keys: Option<Vec<Key>>,
        expect: Counts,
    },
    /// Give marks and notes on `keys` that belong to `from` (alive or deleted) to `to`: a Gebiet that was reshaped or drawn again keeps its progress.
    Move {
        from: GebietId,
        to: GebietId,
        keys: Vec<Key>,
    },
}

impl Body {
    /// A short stable name, for counters and logs (no data in it).
    pub fn kind(&self) -> &'static str {
        match self {
            Body::Marks { .. } => "marks",
            Body::Note { .. } => "note",
            Body::Gruppe { .. } => "gruppe",
            Body::GruppeRemove { .. } => "gruppe-remove",
            Body::Gebiet { .. } => "gebiet",
            Body::GebietRemove { .. } => "gebiet-remove",
            Body::Collect { .. } => "collect",
            Body::Release { .. } => "release",
            Body::RunStart { .. } => "run-start",
            Body::RunUpdate { .. } => "run-update",
            Body::RunEnd { .. } => "run-end",
            Body::Cleanup { .. } => "cleanup",
            Body::Move { .. } => "move",
        }
    }
}

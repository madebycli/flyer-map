//! The things an Aktion holds, as they are told to a device. Revisions (`rev`) count up by one with every change of the thing (edit, never a read);
//! marks and notes are last-writer-wins registers stamped with the clock of the device that made them instead.
use crate::ids::{LaufId, NoteId};
use flyermap_core::{note::Flag, Key, OpId, Status};
use flyermap_identity::{Art, GebietId, GruppeId};
use serde::{Deserialize, Serialize};

/// A closed ring of `[longitude, latitude]` points, like GeoJSON: the first point is repeated at the end.
pub type Ring = Vec<[f64; 2]>;

/// A team of the Aktion. Its colour is an index into the palette of the app.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gruppe {
    pub id: GruppeId,
    pub name: String,
    pub color: u8,
    pub rev: u64,
}

/// Who took a Gebiet over (Abholen), and when (server time, ms).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Collected {
    pub by: String,
    pub at: u64,
}

/// A piece of the map to work: to distribute in (Austeilen, belongs to a Gruppe or to none yet) or to collect from (Abholen, a main area with
/// sub-areas inside it).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Gebiet {
    pub id: GebietId,
    pub art: Art,
    /// Austeilen only. A Gebiet without a Gruppe is not yet assigned: only the Admin works in it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gruppe: Option<GruppeId>,
    /// Abholen only: the main area this sub-area lies in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<GebietId>,
    pub name: String,
    pub ring: Ring,
    pub rev: u64,
    /// Abholen only: set while somebody has taken the Gebiet over.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collected: Option<Collected>,
}

/// Who may join a Lauf (Beitritt). The Akteur only keeps the choice; handing out the access is the job of whoever owns the grants.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Join {
    /// Nobody else.
    Closed,
    /// People of the Aktion.
    Team,
    /// Anyone with the link (a guest, for the length of the Lauf).
    Link,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LaufStatus {
    Active,
    Ended,
}

/// A shared outing: one Gebiet, a time window, the people counted by hand. `houses` is the number of houses of the Gebiet done since the start
/// (completed by an edit made within the window), counted from the marks and never accumulated, so replays and late edits cannot skew it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lauf {
    pub id: LaufId,
    pub gebiet: GebietId,
    pub persons: u16,
    pub join: Join,
    pub status: LaufStatus,
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    pub houses: u32,
    /// Who opened it.
    pub by: String,
    pub rev: u64,
}

/// The state of one house or street piece in a Gebiet: the winner of the last-writer-wins race on `key`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mark {
    /// The key from the engine (`h:<id>` or `s:<id>`).
    pub key: Key,
    pub gebiet: GebietId,
    pub status: Status,
    pub op: OpId,
    pub by: String,
}

/// A field note on a house (`h:`), a street piece (`s:`) or a whole Gebiet (`a:<gebiet>`). `rev` is the stamp of the latest edit (last writer wins);
/// a deleted note stays as a tombstone so that every device learns of it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notiz {
    pub id: NoteId,
    pub key: Key,
    pub gebiet: GebietId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flag: Option<Flag>,
    pub text: String,
    pub rev: OpId,
    pub deleted: bool,
    pub by: String,
}

/// How many marks and notes hang on a Gebiet. The size of an orphan heap, and what a clean-up must confirm.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Counts {
    pub marks: u32,
    pub notes: u32,
}

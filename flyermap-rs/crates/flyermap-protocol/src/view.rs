//! What a device reads: the cut-out of the state it may see (snapshot), pages of marks and notes, and catching up on the log from a position.
//! Everything here is already filtered by the rights of the one who asks.
use crate::{
    answer::Answer,
    change::Entry,
    command::Command,
    ids::NoteId,
    model::{Gebiet, Gruppe, Lauf, Mark, Notiz},
};
use flyermap_core::Key;
use flyermap_identity::GebietId;
use serde::{Deserialize, Serialize};

/// Gruppen, Gebiete and Läufe as the caller may see them, at position `head` of the log. Marks and notes follow in pages. A device that holds this
/// and then reads the log from `head` is complete: what the pages bring beyond `head` is applied again harmlessly.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub head: u64,
    /// Entries up to and including this position have been compacted away: a device behind it must take a snapshot.
    pub floor: u64,
    /// The server's clock in ms: devices correct their own with it.
    pub server_now: u64,
    pub gruppen: Vec<Gruppe>,
    pub gebiete: Vec<Gebiet>,
    /// Running Läufe and those that ended recently.
    pub laeufe: Vec<Lauf>,
}

/// Where a page of marks stopped: marks come in the order (Gebiet, key).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarkCursor {
    pub gebiet: GebietId,
    pub key: Key,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MarksPage {
    pub marks: Vec<Mark>,
    /// Ask again `after` this to go on; `None` when that was all.
    pub next: Option<MarkCursor>,
}

/// Where a page of notes stopped: notes come in the order (Gebiet, id).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteCursor {
    pub gebiet: GebietId,
    pub id: NoteId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NotesPage {
    pub notes: Vec<Notiz>,
    pub next: Option<NoteCursor>,
}

/// The answer to "what happened since `seq`?".
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum Catchup {
    /// The entries after `seq` that the caller may see, oldest first. `next` is the position to ask from next: the last entry looked at, also
    /// when it was not shown (the log has no holes, a caller's view of it has). `more` says that `head` is not yet reached.
    Entries { entries: Vec<Entry>, next: u64, head: u64, more: bool },
    /// The device is too far behind (the log was compacted) or ahead of the log (it was reset): take a snapshot.
    Resync { head: u64, floor: u64 },
}

/// `POST …/push`
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PushRequest {
    pub commands: Vec<Command>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PushReply {
    /// One per command, in the order sent.
    pub answers: Vec<Answer>,
    pub head: u64,
    pub server_now: u64,
}

//! What the Akteur says to a command: accepted (with what happened) or refused with a typed reason. Codes are stable and for machines; the German
//! sentences belong to the app, never to the protocol.
use crate::{ids::CommandId, model::Counts};
use flyermap_identity::GebietId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Answer {
    pub cid: CommandId,
    pub verdict: Verdict,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum Verdict {
    /// The command was processed. `applied` items changed the state, `stale` ones were already there or lost the race to a newer one; `refused`
    /// lists items of a batch that were refused on their own (the rest still happened).
    Accepted {
        applied: u32,
        #[serde(default)]
        stale: u32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        refused: Vec<Refused>,
        /// A Gebiet was deleted: what now hangs on it without an owner (see `Cleanup`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        orphans: Option<Counts>,
    },
    /// Nothing happened.
    Rejected { reason: Reason },
}

/// One item of a batch that was refused on its own: its position in the batch and why.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Refused {
    pub index: u32,
    pub reason: Reason,
}

/// Why the rights said no (the answer of `flyermap-identity::decide`; a hint for the app, never the basis of a decision).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Why {
    NoGrant,
    Expired,
    OutOfScope,
    WrongArt,
    MissingCapability,
}

/// What is wrong with a drawn outline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RingFault {
    TooFewPoints,
    TooManyPoints,
    SelfCrossing,
    TooSmall,
    /// A coordinate is not a number, or outside the earth.
    BadCoordinate,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum Reason {
    /// The rights say no.
    Forbidden {
        why: Why,
    },
    /// There is no such thing (or it is not the caller's to know).
    NotFound,
    BadId,
    BadKey,
    BadName,
    BadText,
    BadValue,
    /// The stamp of an edit is not a timestamp of ours.
    BadClock,
    /// The stamp is too far ahead of (or behind) the server's clock.
    ClockSkew,
    BadRing {
        fault: RingFault,
    },
    /// A batch or text is larger than the protocol allows.
    TooLarge {
        limit: u32,
    },
    /// The Aktion holds as many of these as it may.
    LimitReached {
        limit: u32,
    },
    /// The id is taken (also by something deleted: ids are never reused).
    Exists,
    /// The thing is deleted.
    Deleted,
    /// The edit was made on an older revision; `current` is the one to start from.
    RevMismatch {
        current: u64,
    },
    /// The world (Austeilen or Abholen) of a Gebiet cannot change, and a Gruppe or a main area only fits the right world.
    WrongArt,
    /// The Gruppe or main area named does not exist or does not fit.
    BadParent,
    /// A sub-area must lie inside its main area, and stay so.
    OutsideParent,
    /// A Gebiet lies over another one of the same world; `with` is named when the caller may see it.
    Overlaps {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        with: Option<GebietId>,
    },
    /// Something still hangs on it: sub-areas (Gebiet), Gebiete (Gruppe).
    HasChildren,
    /// The Gebiet is taken over (Abholen) or has a Lauf running.
    InUse,
    /// The Gebiet is taken already (Collect), or nobody has it (Release).
    NotFree,
    NotCollected,
    /// Only a Gebiet without sub-areas can be taken over.
    NotLeaf,
    /// A Lauf is already running in the Gebiet.
    RunActive,
    /// The Lauf has ended.
    RunEnded,
    /// Another device owns this key in another Gebiet.
    KeyOwnedElsewhere,
    /// What the person agreed to is not what would happen now; `marks` and `notes` are what would.
    ConfirmMismatch {
        marks: u32,
        notes: u32,
    },
    /// A command id used again for a different command.
    CidReused,
    /// The Akteur could not store it (nothing happened); try again.
    Storage,
}

impl Reason {
    /// The stable code, for counters and logs (no data in it).
    pub fn code(&self) -> &'static str {
        match self {
            Reason::Forbidden { .. } => "forbidden",
            Reason::NotFound => "not_found",
            Reason::BadId => "bad_id",
            Reason::BadKey => "bad_key",
            Reason::BadName => "bad_name",
            Reason::BadText => "bad_text",
            Reason::BadValue => "bad_value",
            Reason::BadClock => "bad_clock",
            Reason::ClockSkew => "clock_skew",
            Reason::BadRing { .. } => "bad_ring",
            Reason::TooLarge { .. } => "too_large",
            Reason::LimitReached { .. } => "limit_reached",
            Reason::Exists => "exists",
            Reason::Deleted => "deleted",
            Reason::RevMismatch { .. } => "rev_mismatch",
            Reason::WrongArt => "wrong_art",
            Reason::BadParent => "bad_parent",
            Reason::OutsideParent => "outside_parent",
            Reason::Overlaps { .. } => "overlaps",
            Reason::HasChildren => "has_children",
            Reason::InUse => "in_use",
            Reason::NotFree => "not_free",
            Reason::NotCollected => "not_collected",
            Reason::NotLeaf => "not_leaf",
            Reason::RunActive => "run_active",
            Reason::RunEnded => "run_ended",
            Reason::KeyOwnedElsewhere => "key_owned_elsewhere",
            Reason::ConfirmMismatch { .. } => "confirm_mismatch",
            Reason::CidReused => "cid_reused",
            Reason::Storage => "storage",
        }
    }
}

impl Verdict {
    pub fn is_accepted(&self) -> bool {
        matches!(self, Verdict::Accepted { .. })
    }

    /// An accepted verdict with only a count.
    pub fn accepted(applied: u32) -> Verdict {
        Verdict::Accepted { applied, stale: 0, refused: Vec::new(), orphans: None }
    }

    pub fn rejected(reason: Reason) -> Verdict {
        Verdict::Rejected { reason }
    }
}

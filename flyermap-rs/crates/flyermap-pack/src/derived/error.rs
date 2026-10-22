//! Everything that can go wrong with a derived pack, typed (the caller decides which text a person sees; support reads the variant).
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum DerivedError {
    // ---- reading a file
    /// Fewer bytes than the fixed head, or a body cut short.
    #[error("the file is cut short")]
    Truncated,
    /// The first bytes are not the magic of a derived map file.
    #[error("not a derived map file")]
    NotDerived,
    /// A format number this build does not know and that is older than the first one (never written).
    #[error("unknown format {0}")]
    UnknownFormat(u16),
    /// Written by a newer build: the layout may differ, so nothing else in the file is read.
    #[error("format {found} is newer than the newest this build reads ({supported})")]
    TooNew { found: u16, supported: u16 },
    /// A byte of the head or body is not what was sealed (the check does not match), or the head is not one this build writes.
    #[error("the file is damaged")]
    Corrupt,
    /// Sealed for another engine: its street pieces and ids may differ from what this engine derives.
    #[error("built for engine {found}, this build is {expected}")]
    EngineVersion { found: String, expected: String },
    /// A pack where a delta was expected, or the other way round.
    #[error("the file is of another kind than asked for")]
    WrongKind,
    /// The inflated payload is not what the head says (length, hash) or does not decode to a network.
    #[error("the payload does not match its head")]
    Payload,

    // ---- deriving
    #[error("the raw map data is not in the shape the engine reads")]
    RawRejected,
    #[error("the outline has fewer than three usable points")]
    BadRing,
    #[error("asked for engine {asked}, this build derives with {built}")]
    EngineAsked { asked: String, built: String },
    #[error("the engine version is longer than the head has room for")]
    EngineVersionTooLong,
    #[error("the payload is larger than a pack may be")]
    TooLarge,

    // ---- deltas
    /// The delta was made against another pack than the one given.
    #[error("the delta is for another base pack")]
    BaseMismatch,
    /// The delta points outside the base pack, or applying it does not give the pack it promises.
    #[error("the delta does not fit its base")]
    DeltaMismatch,
    /// The change is too big to be worth sending: send the new pack itself.
    #[error("the change is larger than the new pack is worth; send the pack")]
    NotWorthIt,

    // ---- manifest
    #[error("the manifest is not valid")]
    Manifest,
}

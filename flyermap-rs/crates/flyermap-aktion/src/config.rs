//! The bounds of one Aktion that are the host's to set (the bounds of a single command are the protocol's, `flyermap_protocol::limits`).
use flyermap_protocol::limits::{FUTURE_SKEW_MS, PAST_SKEW_MS};

#[derive(Clone, Debug)]
pub struct Limits {
    pub max_gruppen: u32,
    pub max_gebiete: u32,
    /// Rows of marks per Gebiet (tombstones count): a person with the right to mark cannot grow the storage without end by inventing keys.
    pub max_marks_per_gebiet: u32,
    pub max_notes_per_gebiet: u32,
    pub max_active_runs: u32,
    /// An edit stamped further ahead of the server clock than this is refused.
    pub future_skew_ms: u64,
    /// An edit stamped further back than this is refused.
    pub past_skew_ms: u64,
    /// How long the answer to a command is kept for retries.
    pub done_ttl_ms: u64,
    /// Läufe that ended within this time still appear in the snapshot.
    pub recent_runs_ms: u64,
    /// Entries of the log that `compact` keeps.
    pub log_keep: u64,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            max_gruppen: 200,
            max_gebiete: 5_000,
            max_marks_per_gebiet: 200_000,
            max_notes_per_gebiet: 5_000,
            max_active_runs: 500,
            future_skew_ms: FUTURE_SKEW_MS,
            past_skew_ms: PAST_SKEW_MS,
            done_ttl_ms: 14 * 24 * 60 * 60 * 1000,
            recent_runs_ms: 48 * 60 * 60 * 1000,
            log_keep: 50_000,
        }
    }
}

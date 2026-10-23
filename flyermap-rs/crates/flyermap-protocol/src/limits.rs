//! The bounds of the protocol. Devices cut their work to these (a batch of marks is at most [`MAX_MARKS`]); the Akteur refuses what exceeds them.
//! They live here, not in the Akteur, so that the app and the server cannot disagree.

/// Marks in one `Marks` command.
pub const MAX_MARKS: usize = 500;
/// Keys in one `Cleanup` or `Move` command.
pub const MAX_KEYS: usize = 500;
/// Commands in one push (HTTP) request.
pub const MAX_COMMANDS: usize = 100;
/// Length of an id, in characters.
pub const MAX_ID: usize = 64;
/// Length of a name (Gruppe, Gebiet), in characters.
pub const MAX_NAME: usize = 80;
/// Points of a ring, the closing point included.
pub const MAX_RING_POINTS: usize = 1_000;
/// Palette entries for a Gruppe colour (0 up to this, exclusive).
pub const COLORS: u8 = 32;
/// People counted by hand in a Lauf.
pub const MAX_PERSONS: u16 = 999;
/// Entries in one catch-up page.
pub const MAX_PAGE_ENTRIES: u32 = 1_000;
/// Rows in one page of marks or notes.
pub const MAX_PAGE_ROWS: u32 = 1_000;
/// A device clock this far ahead of the server is refused (10 minutes): a broken clock must not win every race.
pub const FUTURE_SKEW_MS: u64 = 10 * 60 * 1000;
/// An edit older than this (60 days) is refused: it was made before anything this Aktion still remembers.
pub const PAST_SKEW_MS: u64 = 60 * 24 * 60 * 60 * 1000;

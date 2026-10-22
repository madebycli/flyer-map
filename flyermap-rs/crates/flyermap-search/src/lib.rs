//! Search and command bar of Flyer Map 6 (Plan 061 §6 and §7).
//!
//! One in-memory [`Index`] holds everything a person may look for: streets, houses, Gebiete, Gruppen, people, notes and commands.
//! [`Index::search`] answers a [`Query`] (the text and the [`Context`]: where the map is, which Gebiet, what was used lately, which kinds
//! may appear) with ranked [`Hit`]s grouped by [`Kind`], each with the stretches of its title that matched.
//!
//! What it understands: case, umlauts, "ß", accents and punctuation do not matter ("Straße" = "strasse" = "Str.", "ä" ~ "ae"); a word
//! typed in part finds the word it starts and compound words that contain it ("haupt" → "Hauptstraße", "bahnhof" → "Hauptbahnhof");
//! several words in any order; typos (one edit from four letters, two from eight, also in the part typed so far); house numbers ("12",
//! "12a", "12 a", "12-14", "Hauptstr 12a", "12a Hauptstr") which jump to the house, and a lone number which is read on the street the
//! person is on; commands by their keywords ("neues gebiet", "lauf").
//!
//! Pure: no I/O, no clock, no randomness. Every order is total and independent of how the index was built or updated.
mod entry;
mod error;
mod german;
mod hit;
mod id;
mod index;
mod query;
mod search;
mod text;
mod vocab;

pub use entry::{Area, Art, Command, Entry, Group, House, Kind, KindSet, Note, Person, Street};
pub use error::EntryError;
pub use hit::{Hit, KindGroup, Results};
pub use id::{Id, Point};
pub use index::{Index, Memory};
pub use query::{Context, Query, Recent};
pub use text::normalize;

//! Why an entry cannot be put into the index or taken out of it.
use thiserror::Error;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum EntryError {
    #[error("the entry has an empty id")]
    EmptyId,
    #[error("the entry has no text that can be searched (no letter or digit)")]
    NoText,
    #[error("a house needs a street and a number")]
    IncompleteHouse,
    #[error("an entry with this id is already in the index")]
    Exists,
    #[error("no entry with this id is in the index")]
    Missing,
}

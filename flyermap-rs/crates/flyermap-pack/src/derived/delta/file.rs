//! The delta as a file: the same head and gzip body as a pack (kind 2), whose payload is `bincode(Body)`.
//!
//! The head's `base` is the content the delta applies to and its `content` the content it produces (counts: the produced network's), so a
//! device checks the delta against what it holds before applying and against what it was promised after.
use super::script::Op;
use crate::derived::{
    error::DerivedError,
    header::{Header, Kind},
    seal,
};
use flyermap_engine::model::{Diagnostics, House, Segment};
use serde::{Deserialize, Serialize};

/// A delta's address: `x/<from>/<to>`, both names immutable, so the delta itself never changes either.
pub const DELTA_PREFIX: &str = "x/";

/// What a delta says: how to build the new segments and houses from the old ones, and the new diagnostics (small, always whole).
#[derive(Serialize, Deserialize)]
pub struct Body {
    pub segments: Vec<Op<Segment>>,
    pub houses: Vec<Op<House>>,
    pub diagnostics: Diagnostics,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Delta {
    pub bytes: Vec<u8>,
    pub header: Header,
}

impl Delta {
    /// Takes bytes from storage or the network: every check of `verify`, and the file must be a delta.
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Delta, DerivedError> {
        let header = seal::verify(&bytes)?;
        if header.kind != Kind::Delta {
            return Err(DerivedError::WrongKind);
        }
        Ok(Delta { bytes, header })
    }

    /// The pack name this delta applies to.
    pub fn from_hash(&self) -> String {
        self.header.base_hex()
    }

    /// The pack name this delta produces.
    pub fn to_hash(&self) -> String {
        self.header.content_hex()
    }

    /// `x/<from>/<to>`.
    pub fn address(&self) -> String {
        format!("{DELTA_PREFIX}{}/{}", self.from_hash(), self.to_hash())
    }
}

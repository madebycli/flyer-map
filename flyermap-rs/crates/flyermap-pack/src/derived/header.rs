//! The fixed head in front of every derived file. Everything is little-endian and sits at a fixed offset, so a device can read the version
//! from the first bytes (a ranged request is enough) and cut the gzip body off at `HEADER_LEN` without parsing anything.
//!
//! ```text
//!  0   4  magic "FM6D"
//!  4   2  format (u16)                       1 today; a larger number is refused before anything else is read
//!  6   1  kind                               1 pack, 2 delta
//!  7   1  reserved, 0
//!  8  16  engine version, UTF-8, NUL padded  "v5.6"
//! 24   4  segments (u32)                     counts of the network the file stands for
//! 28   4  visible segments (u32)
//! 32   4  houses (u32)
//! 36   8  payload length (u64)               bytes inside the gzip body once inflated
//! 44  16  content                            hash of the network payload (a delta: of the payload it produces)
//! 60  16  base                               0 for a pack; a delta: the content it applies to
//! 76  16  check                              SHA-256 (128 bits) over bytes 0..76 and the body
//! 92      gzip body
//! ```
use super::{
    error::DerivedError,
    hash::{self, Hash, HASH_LEN},
};

pub const MAGIC: [u8; 4] = *b"FM6D";
/// The newest format this build reads and the only one it writes.
pub const FORMAT: u16 = 1;
pub const HEADER_LEN: usize = 92;
const CHECKED: usize = HEADER_LEN - HASH_LEN;
const ENGINE_FIELD: usize = 16;
/// No pack is larger than this once inflated (a 51 000-house Gebiet is about 40 MB); the head of a hostile file cannot ask for more memory.
pub const MAX_PAYLOAD_LEN: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Pack,
    Delta,
}

/// The size of the network a file stands for: what a screen can show before anything is loaded.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub segments: u32,
    pub visible_segments: u32,
    pub houses: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Header {
    pub format: u16,
    pub kind: Kind,
    pub engine_version: String,
    pub counts: Counts,
    pub payload_len: u64,
    pub content: Hash,
    pub base: Hash,
    pub check: Hash,
}

fn u16_at(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}
fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}
fn u64_at(b: &[u8], at: usize) -> u64 {
    let mut eight = [0; 8];
    eight.copy_from_slice(&b[at..at + 8]);
    u64::from_le_bytes(eight)
}
fn hash_at(b: &[u8], at: usize) -> Hash {
    let mut out = hash::NONE;
    out.copy_from_slice(&b[at..at + HASH_LEN]);
    out
}

impl Header {
    /// The name of the content: 32 hex characters.
    pub fn content_hex(&self) -> String {
        hash::hex(&self.content)
    }
    /// What a delta applies to (all zeros for a pack).
    pub fn base_hex(&self) -> String {
        hash::hex(&self.base)
    }

    /// Bytes 0..76, the part the check covers besides the body.
    pub(crate) fn prefix(&self) -> Result<[u8; CHECKED], DerivedError> {
        let engine = self.engine_version.as_bytes();
        if engine.len() > ENGINE_FIELD || engine.contains(&0) {
            return Err(DerivedError::EngineVersionTooLong);
        }
        let mut out = [0u8; CHECKED];
        out[..4].copy_from_slice(&MAGIC);
        out[4..6].copy_from_slice(&self.format.to_le_bytes());
        out[6] = match self.kind {
            Kind::Pack => 1,
            Kind::Delta => 2,
        };
        out[8..8 + engine.len()].copy_from_slice(engine);
        out[24..28].copy_from_slice(&self.counts.segments.to_le_bytes());
        out[28..32].copy_from_slice(&self.counts.visible_segments.to_le_bytes());
        out[32..36].copy_from_slice(&self.counts.houses.to_le_bytes());
        out[36..44].copy_from_slice(&self.payload_len.to_le_bytes());
        out[44..60].copy_from_slice(&self.content);
        out[60..76].copy_from_slice(&self.base);
        Ok(out)
    }

    /// Reads the head. The magic and the format come first: a file from a newer build is refused as such, whatever else it holds. The check is
    /// *not* verified here (it needs the body); `verify` does that.
    pub fn parse(bytes: &[u8]) -> Result<Header, DerivedError> {
        if bytes.len() < MAGIC.len() {
            return Err(DerivedError::Truncated);
        }
        if bytes[..4] != MAGIC {
            return Err(DerivedError::NotDerived);
        }
        if bytes.len() < 6 {
            return Err(DerivedError::Truncated);
        }
        let format = u16_at(bytes, 4);
        if format == 0 {
            return Err(DerivedError::UnknownFormat(format));
        }
        if format > FORMAT {
            return Err(DerivedError::TooNew { found: format, supported: FORMAT });
        }
        if bytes.len() < HEADER_LEN {
            return Err(DerivedError::Truncated);
        }
        let kind = match bytes[6] {
            1 => Kind::Pack,
            2 => Kind::Delta,
            _ => return Err(DerivedError::Corrupt),
        };
        let field = &bytes[8..8 + ENGINE_FIELD];
        let used = field.iter().position(|&b| b == 0).unwrap_or(ENGINE_FIELD);
        if bytes[7] != 0 || field[used..].iter().any(|&b| b != 0) {
            return Err(DerivedError::Corrupt);
        }
        let engine_version = std::str::from_utf8(&field[..used]).map_err(|_| DerivedError::Corrupt)?.to_string();
        let payload_len = u64_at(bytes, 36);
        if payload_len > MAX_PAYLOAD_LEN {
            return Err(DerivedError::TooLarge);
        }
        let header = Header {
            format,
            kind,
            engine_version,
            counts: Counts { segments: u32_at(bytes, 24), visible_segments: u32_at(bytes, 28), houses: u32_at(bytes, 32) },
            payload_len,
            content: hash_at(bytes, 44),
            base: hash_at(bytes, 60),
            check: hash_at(bytes, CHECKED),
        };
        // A pack has no base; a delta always has one.
        if (kind == Kind::Pack) != (header.base == hash::NONE) {
            return Err(DerivedError::Corrupt);
        }
        Ok(header)
    }

    /// The whole head as it is written, with the given check.
    pub(crate) fn to_bytes(&self) -> Result<[u8; HEADER_LEN], DerivedError> {
        let mut out = [0u8; HEADER_LEN];
        out[..CHECKED].copy_from_slice(&self.prefix()?);
        out[CHECKED..].copy_from_slice(&self.check);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Header {
        Header {
            format: FORMAT,
            kind: Kind::Delta,
            engine_version: "v5.6".into(),
            counts: Counts { segments: 7, visible_segments: 5, houses: 3 },
            payload_len: 1234,
            content: [1; HASH_LEN],
            base: [2; HASH_LEN],
            check: [3; HASH_LEN],
        }
    }

    #[test]
    fn the_head_round_trips_and_has_its_documented_size() {
        let bytes = sample().to_bytes().unwrap();
        assert_eq!(bytes.len(), HEADER_LEN);
        assert_eq!(&bytes[..4], b"FM6D");
        assert_eq!(Header::parse(&bytes).unwrap(), sample());
    }

    #[test]
    fn a_newer_format_is_refused_before_anything_else_is_read() {
        let mut bytes = sample().to_bytes().unwrap().to_vec();
        bytes[4] = 2;
        assert_eq!(Header::parse(&bytes), Err(DerivedError::TooNew { found: 2, supported: 1 }));
        // even when what follows is not a head at all
        assert_eq!(Header::parse(&[b'F', b'M', b'6', b'D', 9, 0]), Err(DerivedError::TooNew { found: 9, supported: 1 }));
        bytes[4] = 0;
        assert_eq!(Header::parse(&bytes), Err(DerivedError::UnknownFormat(0)));
    }

    #[test]
    fn short_and_foreign_input_is_named_for_what_it_is() {
        assert_eq!(Header::parse(&[]), Err(DerivedError::Truncated));
        assert_eq!(Header::parse(b"FM6"), Err(DerivedError::Truncated));
        assert_eq!(Header::parse(b"FM6D"), Err(DerivedError::Truncated));
        assert_eq!(Header::parse(b"\x1f\x8b\x08\0 and then some more bytes"), Err(DerivedError::NotDerived));
        let bytes = sample().to_bytes().unwrap();
        assert_eq!(Header::parse(&bytes[..HEADER_LEN - 1]), Err(DerivedError::Truncated));
    }

    #[test]
    fn an_engine_version_that_does_not_fit_is_not_written() {
        let mut head = sample();
        head.engine_version = "v5.6.0-a-very-long-name".into();
        assert_eq!(head.to_bytes(), Err(DerivedError::EngineVersionTooLong));
    }
}

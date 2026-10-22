//! The transport format of a pack: the raw JSON, gzip. Any gzip reader opens it; the bytes differ from the TypeScript encoder's (another
//! compressor), the content does not.
use crate::normalize::RawOsm;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use std::io::{Read, Write};

pub fn encode(raw: &RawOsm) -> Vec<u8> {
    let json = serde_json::to_vec(raw).unwrap_or_default();
    let mut encoder = GzEncoder::new(Vec::with_capacity(json.len() / 4), Compression::default());
    // Writing into a Vec cannot fail.
    let _ = encoder.write_all(&json);
    encoder.finish().unwrap_or_default()
}

/// The JSON inside a pack (for tests and tools).
pub fn decode(bytes: &[u8]) -> Option<serde_json::Value> {
    let mut text = Vec::new();
    GzDecoder::new(bytes).read_to_end(&mut text).ok()?;
    serde_json::from_slice(&text).ok()
}

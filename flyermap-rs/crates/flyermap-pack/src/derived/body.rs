//! The body of a derived file: one gzip member. Any gzip reader opens it (the browser's `DecompressionStream('gzip')` included).
//!
//! The gzip head is written by hand, not by the library: the library puts the operating system into it, so the same input would give other
//! bytes on another machine. Here the head is always `1f 8b 08 00 00000000 <xfl> ff`. The compressor itself is pure Rust and the same on
//! every target, so one input gives one output.
use super::error::DerivedError;
use flate2::{bufread::GzDecoder, write::DeflateEncoder, Compression, Crc};
use std::io::{Read, Write};

/// Level 6: on 51 000 houses level 9 is 0.05 % smaller (4059.5 kB against 4061.5 kB) and takes 1.9 s instead of 0.7 s to compress; level 1 is
/// 18 % larger. Measured with `examples/derived_bench.rs` on the synthetic city. The name of a pack is the hash of the payload, so the level
/// changes the stored bytes only, never the name.
pub const LEVEL: u32 = 6;
/// The most the inflater reserves up front; more is allocated as it grows.
const RESERVE: u64 = 64 * 1024 * 1024;

pub fn gzip(payload: &[u8], level: u32) -> Vec<u8> {
    let extra_flags = match level {
        9 => 2,
        0 | 1 => 4,
        _ => 0,
    };
    let mut out = Vec::with_capacity(payload.len() / 4 + 32);
    out.extend_from_slice(&[0x1f, 0x8b, 8, 0, 0, 0, 0, 0, extra_flags, 0xff]);
    let mut encoder = DeflateEncoder::new(out, Compression::new(level));
    // Writing into a Vec cannot fail.
    let _ = encoder.write_all(payload);
    let mut out = encoder.finish().unwrap_or_default();
    let mut crc = Crc::new();
    crc.update(payload);
    out.extend_from_slice(&crc.sum().to_le_bytes());
    // The length modulo 2^32, as the format says.
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out
}

/// The payload of a body, which must be exactly `expected` bytes long once inflated and must end where the gzip member ends: a head that
/// promises one length and a body that holds another is refused, so a small file cannot ask for a large allocation.
pub fn gunzip(body: &[u8], expected: u64) -> Result<Vec<u8>, DerivedError> {
    let mut decoder = GzDecoder::new(body);
    let mut out = Vec::with_capacity(expected.min(RESERVE) as usize);
    let read = (&mut decoder).take(expected.saturating_add(1)).read_to_end(&mut out);
    if read.is_err() || out.len() as u64 != expected {
        return Err(DerivedError::Payload);
    }
    if !decoder.into_inner().is_empty() {
        return Err(DerivedError::Payload);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_canonical_head() {
        let payload: Vec<u8> = (0..50_000u32).flat_map(|i| (i % 251).to_le_bytes()).collect();
        for level in [1, 6, 9] {
            let body = gzip(&payload, level);
            assert_eq!(&body[..8], &[0x1f, 0x8b, 8, 0, 0, 0, 0, 0]);
            assert_eq!(body[9], 0xff);
            assert_eq!(gunzip(&body, payload.len() as u64).unwrap(), payload);
            assert_eq!(gzip(&payload, level), body, "same input, same bytes");
        }
        assert_eq!(gunzip(&gzip(&[], 9), 0).unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn a_wrong_length_or_trailing_bytes_are_refused() {
        let body = gzip(b"hello hello hello hello", 9);
        assert_eq!(gunzip(&body, 22), Err(DerivedError::Payload));
        assert_eq!(gunzip(&body, 24), Err(DerivedError::Payload));
        let mut longer = body.clone();
        longer.push(0);
        assert_eq!(gunzip(&longer, 23), Err(DerivedError::Payload));
        assert_eq!(gunzip(&body[..body.len() - 1], 23), Err(DerivedError::Payload));
    }
}

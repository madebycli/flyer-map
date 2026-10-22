//! Sealing and opening a file: head + gzip body, and the check that ties every byte of both together.
//!
//! The check is SHA-256 (128 bits) over the head's first 76 bytes and the whole body, stored in the head's last 16. Nothing is left out, so a
//! bit flipped anywhere in the file (head, gzip head, deflate stream, even the padding bits a deflate reader would ignore) fails it. That
//! is why the check covers the *stored* bytes while the content name covers the *payload*: the name stays the same whichever compressor wrote
//! the body, the check proves that these bytes are the ones that were written.
use super::{
    body,
    error::DerivedError,
    hash::{self, Hash},
    header::{Counts, Header, Kind, FORMAT, HEADER_LEN},
};

/// A finished file with the head it carries.
pub(crate) struct Sealed {
    pub bytes: Vec<u8>,
    pub header: Header,
}

pub(crate) struct Meta<'a> {
    pub kind: Kind,
    pub engine_version: &'a str,
    pub counts: Counts,
    pub content: Hash,
    pub base: Hash,
}

pub(crate) fn seal(meta: &Meta, payload: &[u8], level: u32) -> Result<Sealed, DerivedError> {
    let mut header = Header {
        format: FORMAT,
        kind: meta.kind,
        engine_version: meta.engine_version.to_string(),
        counts: meta.counts,
        payload_len: payload.len() as u64,
        content: meta.content,
        base: meta.base,
        check: hash::NONE,
    };
    let body = body::gzip(payload, level);
    let prefix = header.prefix()?;
    header.check = hash::of_parts(&[&prefix, &body]);
    let mut bytes = Vec::with_capacity(HEADER_LEN + body.len());
    bytes.extend_from_slice(&header.to_bytes()?);
    bytes.extend_from_slice(&body);
    Ok(Sealed { bytes, header })
}

/// The head and the body of a file once everything that needs no inflating has been checked: magic, format (a newer one is refused as
/// such), the head's shape, the check over every byte, and the engine version.
pub(crate) fn split(bytes: &[u8]) -> Result<(Header, &[u8]), DerivedError> {
    let header = Header::parse(bytes)?;
    if bytes.len() == HEADER_LEN {
        return Err(DerivedError::Truncated);
    }
    let body = &bytes[HEADER_LEN..];
    if hash::of_parts(&[&bytes[..HEADER_LEN - header.check.len()], body]) != header.check {
        return Err(DerivedError::Corrupt);
    }
    if header.engine_version != flyermap_engine::ENGINE_VERSION {
        return Err(DerivedError::EngineVersion { found: header.engine_version, expected: flyermap_engine::ENGINE_VERSION.to_string() });
    }
    Ok((header, body))
}

/// The head of a pack or delta, checked as far as its bytes allow without inflating: structure, version and the check over every byte.
pub fn verify(bytes: &[u8]) -> Result<Header, DerivedError> {
    split(bytes).map(|(header, _)| header)
}

/// The head and the inflated payload; for a pack the payload is also checked against the content name in the head.
pub(crate) fn unseal(bytes: &[u8]) -> Result<(Header, Vec<u8>), DerivedError> {
    let (header, body) = split(bytes)?;
    let payload = body::gunzip(body, header.payload_len)?;
    if header.kind == Kind::Pack && hash::of(&payload) != header.content {
        return Err(DerivedError::Payload);
    }
    Ok((header, payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(payload: &[u8]) -> Sealed {
        let meta =
            Meta { kind: Kind::Pack, engine_version: flyermap_engine::ENGINE_VERSION, counts: Counts::default(), content: hash::of(payload), base: hash::NONE };
        seal(&meta, payload, 6).unwrap()
    }

    #[test]
    fn sealed_files_verify_and_unseal() {
        let payload = b"payload payload payload payload".repeat(50);
        let file = sample(&payload);
        assert_eq!(verify(&file.bytes).unwrap(), file.header);
        let (header, back) = unseal(&file.bytes).unwrap();
        assert_eq!((header, back), (file.header, payload));
    }

    #[test]
    fn a_flipped_bit_anywhere_is_refused() {
        let file = sample(&b"some bytes that compress somewhat somewhat somewhat".repeat(8));
        for byte in 0..file.bytes.len() {
            for bit in 0..8 {
                let mut bad = file.bytes.clone();
                bad[byte] ^= 1 << bit;
                assert!(verify(&bad).is_err(), "byte {byte} bit {bit} went through");
            }
        }
    }

    #[test]
    fn another_engine_is_named_not_called_damaged() {
        let payload = b"x".repeat(100);
        let meta = Meta { kind: Kind::Pack, engine_version: "v0.0", counts: Counts::default(), content: hash::of(&payload), base: hash::NONE };
        let file = seal(&meta, &payload, 6).unwrap();
        assert_eq!(verify(&file.bytes), Err(DerivedError::EngineVersion { found: "v0.0".into(), expected: flyermap_engine::ENGINE_VERSION.into() }));
    }

    #[test]
    fn a_head_alone_or_a_cut_body_is_refused() {
        let file = sample(&b"cut me".repeat(100));
        assert_eq!(verify(&file.bytes[..HEADER_LEN]), Err(DerivedError::Truncated));
        for cut in [HEADER_LEN + 1, file.bytes.len() - 1, file.bytes.len() / 2] {
            assert!(verify(&file.bytes[..cut]).is_err(), "cut at {cut}");
        }
        let mut longer = file.bytes.clone();
        longer.push(0);
        assert!(verify(&longer).is_err());
    }
}

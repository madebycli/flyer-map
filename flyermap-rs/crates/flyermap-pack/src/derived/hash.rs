//! The names of things: SHA-256 cut to 128 bits, written as 32 hex characters. 128 bits keep a collision out of reach for the number of maps
//! there will ever be, and the name stays short enough for a URL.
use sha2::{Digest, Sha256};

pub const HASH_LEN: usize = 16;
pub type Hash = [u8; HASH_LEN];
/// What a pack without a base carries in the base field.
pub const NONE: Hash = [0; HASH_LEN];

pub fn of(data: &[u8]) -> Hash {
    of_parts(&[data])
}

/// The hash of the parts one after the other, as if they were one slice (no copy).
pub fn of_parts(parts: &[&[u8]]) -> Hash {
    let mut sha = Sha256::new();
    for part in parts {
        sha.update(part);
    }
    let full = sha.finalize();
    let mut out = NONE;
    out.copy_from_slice(&full[..HASH_LEN]);
    out
}

pub fn hex(hash: &Hash) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(HASH_LEN * 2);
    for byte in hash {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 15)]));
    }
    out
}

/// The hash written by `hex` (lower case only: a name has exactly one spelling).
pub fn parse(text: &str) -> Option<Hash> {
    let bytes = text.as_bytes();
    if bytes.len() != HASH_LEN * 2 {
        return None;
    }
    let digit = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut out = NONE;
    for (i, pair) in bytes.chunks(2).enumerate() {
        out[i] = (digit(pair[0])? << 4) | digit(pair[1])?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_answer_and_spelling() {
        // SHA-256("abc") = ba7816bf 8f01cfea 414140de 5dae2223 b00361a3 96177a9c b410ff61 f20015ad
        assert_eq!(hex(&of(b"abc")), "ba7816bf8f01cfea414140de5dae2223");
        assert_eq!(of_parts(&[b"a", b"", b"bc"]), of(b"abc"));
        assert_eq!(parse("ba7816bf8f01cfea414140de5dae2223"), Some(of(b"abc")));
        assert_eq!(parse("BA7816BF8F01CFEA414140DE5DAE2223"), None);
        assert_eq!(parse("ba7816bf8f01cfea414140de5dae222"), None);
        assert_eq!(parse("ba7816bf8f01cfea414140de5dae222g"), None);
    }
}

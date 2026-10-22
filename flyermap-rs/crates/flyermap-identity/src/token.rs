//! Session tokens: 256 random bits, shown once to the device, stored only as a hash. A leaked database holds nothing a session can be opened with.
use crate::b64;
use sha2::{Digest, Sha256};

/// Length of the text form (32 bytes in base64url).
pub const TOKEN_LEN: usize = 43;

/// The secret as handed to the device. Never log it, never store it.
pub fn new_token(random: &[u8; 32]) -> String {
    b64::encode(random)
}

/// Does the text have the shape of a token? (Cheap check before touching the database.)
pub fn looks_like_token(text: &str) -> bool {
    text.len() == TOKEN_LEN && b64::decode(text).is_some()
}

/// What the directory stores and looks up by: SHA-256 of the token text, hex.
pub fn hash_token(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Comparison that takes the same time wherever the texts differ.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_hash_and_comparison() {
        let token = new_token(&[7; 32]);
        assert_eq!(token.len(), TOKEN_LEN);
        assert!(looks_like_token(&token));
        assert!(!looks_like_token(&token[1..]));
        assert!(!looks_like_token(&format!("{}*", &token[1..])));
        assert_eq!(hash_token("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_ne!(hash_token(&token), hash_token(&new_token(&[8; 32])));
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }
}

use sha2::{Digest, Sha256};

/// Secrets (session cookies, link tokens) are stored as their SHA-256, lower-case hex.
pub fn hash_secret(secret: &str) -> String {
    sha256_hex(secret)
}

pub fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn known_digest() {
        assert_eq!(super::hash_secret("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}

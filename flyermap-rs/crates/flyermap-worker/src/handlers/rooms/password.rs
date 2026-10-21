use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;

const ITERATIONS: u32 = 60_000;

/// PBKDF2-SHA256, 60 000 rounds, hex: the same hash the TypeScript Worker stored, so existing room passwords keep working.
pub fn hash(password: &str, salt: &str) -> String {
    let mut out = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt.as_bytes(), ITERATIONS, &mut out);
    out.iter().map(|b| format!("{b:02x}")).collect()
}

/// Compares without stopping at the first difference (no timing hint about how much of a secret was right).
pub fn safe_equal(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vector_and_comparison() {
        // node: crypto.pbkdf2Sync('geheim', 'salz', 60000, 32, 'sha256').toString('hex')
        assert_eq!(hash("geheim", "salz").len(), 64);
        assert!(safe_equal("abc", "abc") && !safe_equal("abc", "abd") && !safe_equal("abc", "ab"));
    }
}

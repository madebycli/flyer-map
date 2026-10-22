//! Recovery codes: one-time codes a person keeps for the day all devices and passkeys are gone. 12 characters (60 bits) from the same alphabet as
//! invitations, stored only as hashes, each usable once.
use crate::{invite::ALPHABET, token::hex};
use sha2::{Digest, Sha256};

pub const CODE_LEN: usize = 12;
pub const COUNT: usize = 8;

/// `COUNT` codes from `COUNT * CODE_LEN` random bytes.
pub fn new_codes(random: &[u8; COUNT * CODE_LEN]) -> Vec<String> {
    random.chunks(CODE_LEN).map(|c| c.iter().map(|b| ALPHABET[(b & 31) as usize] as char).collect()).collect()
}

/// `ABCD-EFGH-JKMN`.
pub fn display(code: &str) -> String {
    code.as_bytes().chunks(4).map(|c| String::from_utf8_lossy(c).into_owned()).collect::<Vec<_>>().join("-")
}

pub fn normalize(input: &str) -> Option<String> {
    let code: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    (code.len() == CODE_LEN && code.bytes().all(|b| ALPHABET.contains(&b))).then_some(code)
}

pub fn hash_code(code: &str) -> String {
    hex(&Sha256::digest(format!("flyermap-recovery:{code}").as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eight_distinct_codes_that_read_back() {
        let random: Vec<u8> = (0..COUNT * CODE_LEN).map(|i| (i * 7 + i / 5) as u8).collect();
        let codes = new_codes(random.as_slice().try_into().unwrap());
        assert_eq!(codes.len(), COUNT);
        assert_eq!(codes.iter().collect::<std::collections::HashSet<_>>().len(), COUNT);
        for c in &codes {
            assert_eq!(c.len(), CODE_LEN);
            assert_eq!(normalize(&display(c)).as_ref(), Some(c));
        }
        assert_eq!(display("0123456789AB"), "0123-4567-89AB");
        assert_ne!(hash_code("0123456789AB"), crate::invite::hash_code("0123456789AB"), "a recovery code is not an invitation");
    }
}

//! Sealing small secrets at rest (TOTP secrets) with AES-256-GCM under the server key. Format: `v1.<nonce>.<ciphertext>`, both base64url.
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use flyermap_identity::b64;

pub fn seal(key: &[u8; 32], nonce: &[u8; 12], plain: &[u8]) -> String {
    let cipher = Aes256Gcm::new(key.into());
    // encrypting into a Vec cannot fail for inputs this small
    let sealed = cipher.encrypt(Nonce::from_slice(nonce), plain).unwrap_or_default();
    format!("v1.{}.{}", b64::encode(nonce), b64::encode(&sealed))
}

pub fn open(key: &[u8; 32], text: &str) -> Option<Vec<u8>> {
    let mut parts = text.split('.');
    let (version, nonce, sealed) = (parts.next()?, b64::decode(parts.next()?)?, b64::decode(parts.next()?)?);
    if version != "v1" || nonce.len() != 12 || parts.next().is_some() {
        return None;
    }
    Aes256Gcm::new(key.into()).decrypt(Nonce::from_slice(&nonce), sealed.as_slice()).ok()
}

/// The key from its configured text (base64url of 32 bytes).
pub fn key_from(text: &str) -> Option<[u8; 32]> {
    b64::decode(text)?.try_into().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seals_and_refuses_changes() {
        let (key, other) = ([1u8; 32], [2u8; 32]);
        let sealed = seal(&key, &[5; 12], b"JBSWY3DPEHPK3PXP");
        assert_eq!(open(&key, &sealed).unwrap(), b"JBSWY3DPEHPK3PXP");
        assert!(open(&other, &sealed).is_none());
        let mut broken = sealed.clone();
        broken.pop();
        broken.push('A');
        assert!(open(&key, &broken).is_none());
        assert!(open(&key, "v2.AA.AA").is_none());
        assert!(open(&key, "v1.AA").is_none());
        assert_eq!(key_from(&flyermap_identity::b64::encode(&key)), Some(key));
        assert_eq!(key_from("short"), None);
    }
}

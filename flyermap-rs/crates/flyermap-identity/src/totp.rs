//! Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s), the optional second factor.
use hmac::{Hmac, Mac};
use sha1::Sha1;

pub const STEP_SECONDS: u64 = 30;
pub const DIGITS: usize = 6;
const B32: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn base32_encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    let (mut bits, mut count) = (0u32, 0);
    for b in bytes {
        bits = bits << 8 | u32::from(*b);
        count += 8;
        while count >= 5 {
            count -= 5;
            out.push(B32[(bits >> count & 31) as usize] as char);
        }
        bits &= (1 << count) - 1;
    }
    if count > 0 {
        out.push(B32[(bits << (5 - count) & 31) as usize] as char);
    }
    out
}

/// Authenticator apps show secrets in groups and lower case; both are accepted.
pub fn base32_decode(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut bits, mut count) = (0u32, 0);
    for c in text.chars().filter(|c| !c.is_whitespace() && *c != '-' && *c != '=') {
        let v = B32.iter().position(|b| *b == c.to_ascii_uppercase() as u8)? as u32;
        bits = bits << 5 | v;
        count += 5;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    Some(out)
}

/// The code for one 30-second step (`counter` = seconds since the epoch / 30).
pub fn code(secret: &[u8], counter: u64) -> String {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC takes any key length");
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[19] & 15) as usize;
    let n = u32::from_be_bytes([digest[offset] & 0x7f, digest[offset + 1], digest[offset + 2], digest[offset + 3]]);
    format!("{:0width$}", n % 10u32.pow(DIGITS as u32), width = DIGITS)
}

/// Checks the typed code against the current step and its neighbours (clock drift). Returns the matching step so the caller can store it:
/// a step at or below `last_used` is refused, so a code observed once cannot be used again.
pub fn verify(secret: &[u8], now_ms: u64, typed: &str, last_used: Option<u64>) -> Option<u64> {
    let typed: String = typed.chars().filter(|c| !c.is_whitespace()).collect();
    if typed.len() != DIGITS || !typed.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let now = now_ms / 1000 / STEP_SECONDS;
    (now.saturating_sub(1)..=now + 1)
        .find(|step| last_used.is_none_or(|last| *step > last) && crate::token::constant_time_eq(code(secret, *step).as_bytes(), typed.as_bytes()))
}

/// What the QR code of the authenticator app carries.
pub fn otpauth_uri(issuer: &str, account: &str, secret: &[u8]) -> String {
    let enc = |s: &str| {
        s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>()
    };
    format!(
        "otpauth://totp/{}:{}?secret={}&issuer={}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}",
        enc(issuer),
        enc(account),
        base32_encode(secret),
        enc(issuer)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    const SECRET: &[u8] = b"12345678901234567890";

    #[test]
    fn rfc_6238_vectors() {
        // RFC 6238 appendix B (SHA-1), last six digits of the eight-digit values
        for (seconds, expected) in [
            (59u64, "287082"),
            (1_111_111_109, "081804"),
            (1_111_111_111, "050471"),
            (1_234_567_890, "005924"),
            (2_000_000_000, "279037"),
            (20_000_000_000, "353130"),
        ] {
            assert_eq!(code(SECRET, seconds / STEP_SECONDS), expected, "t={seconds}");
        }
    }

    #[test]
    fn base32_round_trip_and_tolerance() {
        assert_eq!(base32_encode(SECRET), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
        assert_eq!(base32_decode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq").unwrap(), SECRET);
        assert!(base32_decode("GEZ1").is_none());
        for n in 0..24usize {
            let bytes: Vec<u8> = (0..n).map(|i| (i * 31 + 7) as u8).collect();
            assert_eq!(base32_decode(&base32_encode(&bytes)).unwrap(), bytes);
        }
    }

    #[test]
    fn a_code_works_once_within_the_drift_window() {
        let now = 1_234_567_890_000u64;
        let step = now / 1000 / STEP_SECONDS;
        assert_eq!(verify(SECRET, now, "005924", None), Some(step));
        assert_eq!(verify(SECRET, now, " 005 924 ", None), Some(step));
        assert_eq!(verify(SECRET, now, "005924", Some(step)), None, "used already");
        assert_eq!(verify(SECRET, now + 30_000, "005924", Some(step - 1)), Some(step), "a step late is fine");
        assert_eq!(verify(SECRET, now + 90_000, "005924", None), None, "three steps late is not");
        assert_eq!(verify(SECRET, now, "00592", None), None);
        assert_eq!(verify(SECRET, now, "00592x", None), None);
        assert_eq!(verify(SECRET, now, "005925", None), None);
    }

    #[test]
    fn the_uri_has_what_apps_need() {
        let uri = otpauth_uri("Flyer Map", "anna@example.org", b"12345678901234567890");
        assert!(uri.starts_with("otpauth://totp/Flyer%20Map:anna%40example.org?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Flyer%20Map"));
    }
}

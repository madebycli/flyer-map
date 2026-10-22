//! base64url without padding (RFC 4648 §5), the form tokens, challenges and passkey data travel in.
const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// Strict: only the alphabet, no padding, no whitespace; `None` for anything else (also for a length that cannot occur).
pub fn decode(text: &str) -> Option<Vec<u8>> {
    if text.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut bits, mut count) = (0u32, 0);
    for b in text.bytes() {
        let v = ALPHABET.iter().position(|a| *a == b)? as u32;
        bits = bits << 6 | v;
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    // leftover bits must be zero, otherwise two texts would decode to the same bytes
    (bits == 0).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc_vectors_and_round_trip() {
        for (plain, coded) in [("", ""), ("f", "Zg"), ("fo", "Zm8"), ("foo", "Zm9v"), ("foob", "Zm9vYg"), ("fooba", "Zm9vYmE"), ("foobar", "Zm9vYmFy")] {
            assert_eq!(encode(plain.as_bytes()), coded);
            assert_eq!(decode(coded).unwrap(), plain.as_bytes());
        }
        assert_eq!(encode(&[0xfb, 0xff]), "-_8");
        for n in 0..70u8 {
            let bytes: Vec<u8> = (0..n).map(|i| i.wrapping_mul(37)).collect();
            assert_eq!(decode(&encode(&bytes)).unwrap(), bytes);
        }
    }

    #[test]
    fn strict() {
        for bad in ["Zg==", "Zm9v ", "Zm9*", "Z", "Zh", "+/8"] {
            assert!(decode(bad).is_none(), "{bad}");
        }
    }
}

//! The credential public key as COSE (RFC 8152): an ES256 key is a map with kty 2 (EC2), alg -7, crv 1 (P-256), x and y.
use super::Problem;
use ciborium::value::Value;

fn int(v: &Value) -> Option<i128> {
    v.as_integer().map(i128::from)
}

fn get(map: &[(Value, Value)], key: i64) -> Option<&Value> {
    map.iter().find(|(k, _)| int(k) == Some(i128::from(key))).map(|(_, v)| v)
}

/// The key as a SEC1 uncompressed point (0x04 ‖ x ‖ y).
pub fn es256_public_key(value: &Value) -> Result<Vec<u8>, Problem> {
    let map = value.as_map().ok_or(Problem::Malformed)?;
    let is = |key: i64, want: i128| get(map, key).and_then(int) == Some(want);
    if !(is(1, 2) && is(3, -7) && is(-1, 1)) {
        return Err(Problem::UnsupportedKey);
    }
    let coord = |key: i64| get(map, key).and_then(Value::as_bytes).filter(|b| b.len() == 32).ok_or(Problem::Malformed);
    let mut point = vec![0x04];
    point.extend_from_slice(coord(-2)?);
    point.extend_from_slice(coord(-3)?);
    // refuse points that are not on the curve now, not at the first sign-in
    p256::ecdsa::VerifyingKey::from_sec1_bytes(&point).map_err(|_| Problem::UnsupportedKey)?;
    Ok(point)
}

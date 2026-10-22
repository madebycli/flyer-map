//! `clientDataJSON`: what the browser says it did (the ceremony type, our challenge, the origin it ran on).
use super::{Expect, Problem};
use crate::{b64, token::constant_time_eq};
use serde::Deserialize;

#[derive(Deserialize)]
struct ClientData {
    #[serde(rename = "type")]
    kind: String,
    challenge: String,
    origin: String,
}

pub fn check(json: &[u8], expected_type: &str, expect: &Expect<'_>) -> Result<(), Problem> {
    let data: ClientData = serde_json::from_slice(json).map_err(|_| Problem::Malformed)?;
    if data.kind != expected_type {
        return Err(Problem::WrongCeremony);
    }
    let challenge = b64::decode(&data.challenge).ok_or(Problem::Malformed)?;
    if !constant_time_eq(&challenge, expect.challenge) {
        return Err(Problem::WrongCeremony);
    }
    if !expect.origins.contains(&data.origin.as_str()) {
        return Err(Problem::WrongOrigin);
    }
    Ok(())
}

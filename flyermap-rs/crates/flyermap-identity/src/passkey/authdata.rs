//! The authenticator data block: rp id hash, flags, counter, and (at registration) the new credential.
use super::Problem;

pub const FLAG_UP: u8 = 0x01;
pub const FLAG_UV: u8 = 0x04;
pub const FLAG_AT: u8 = 0x40;

pub struct AuthData<'a> {
    pub rp_id_hash: &'a [u8],
    pub flags: u8,
    pub sign_count: u32,
    /// Everything after the 37-byte head (the attested credential data at registration).
    pub rest: &'a [u8],
}

pub fn parse(data: &[u8]) -> Result<AuthData<'_>, Problem> {
    if data.len() < 37 {
        return Err(Problem::Malformed);
    }
    Ok(AuthData { rp_id_hash: &data[..32], flags: data[32], sign_count: u32::from_be_bytes([data[33], data[34], data[35], data[36]]), rest: &data[37..] })
}

/// The shared checks: right relying party, user present, verified if demanded.
pub fn check(auth: &AuthData<'_>, rp_id: &str, require_uv: bool) -> Result<(), Problem> {
    use sha2::{Digest, Sha256};
    if !crate::token::constant_time_eq(auth.rp_id_hash, &Sha256::digest(rp_id.as_bytes())) {
        return Err(Problem::WrongRelyingParty);
    }
    if auth.flags & FLAG_UP == 0 {
        return Err(Problem::NotPresent);
    }
    if require_uv && auth.flags & FLAG_UV == 0 {
        return Err(Problem::NotVerified);
    }
    Ok(())
}

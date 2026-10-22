//! Passkeys (WebAuthn), the optional sign-in without a password. The browser makes a key pair on the device; we keep the public half and check
//! signatures made with the private half. Only what is needed: ES256 (P-256), attestation "none", a registration and an assertion check.
//!
//! The caller owns the challenge (random bytes it handed to the browser and remembers for a short time), the relying party id (the host name) and
//! the allowed origins. Nothing here knows time or randomness.
mod assertion;
mod authdata;
mod client;
mod cose;
mod registration;

pub use assertion::{verify_assertion, Assertion};
pub use registration::{verify_registration, Registration};

/// What the caller expects for this ceremony.
#[derive(Clone, Debug)]
pub struct Expect<'a> {
    /// The host name the passkey belongs to, e.g. `flyer.example.org`.
    pub rp_id: &'a str,
    /// Allowed origins, e.g. `https://flyer.example.org`.
    pub origins: &'a [&'a str],
    /// The random bytes handed to the browser for this attempt.
    pub challenge: &'a [u8],
    /// Demand that the person was verified on the device (fingerprint, PIN), not just present.
    pub require_user_verification: bool,
}

/// What the directory stores per passkey.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Passkey {
    pub credential_id: Vec<u8>,
    /// SEC1 uncompressed P-256 point (65 bytes).
    pub public_key: Vec<u8>,
    pub sign_count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Problem {
    /// Malformed data from the browser.
    Malformed,
    /// Not the ceremony we asked for (type, challenge).
    WrongCeremony,
    /// Origin not allowed.
    WrongOrigin,
    /// Made for another relying party id.
    WrongRelyingParty,
    /// The user-present flag is missing.
    NotPresent,
    /// The user-verified flag is missing but demanded.
    NotVerified,
    /// A key type we do not accept (only ES256).
    UnsupportedKey,
    /// An attestation format other than "none".
    UnsupportedAttestation,
    /// The signature does not fit the key and the data.
    BadSignature,
    /// The counter went back: the key may be cloned.
    CounterWentBack,
}

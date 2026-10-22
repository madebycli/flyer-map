//! The values that cross the seam (besides the model: `Boot`, a pack's address, a drawn Gebiet, the answer to joining).
use crate::model::{LngLat, World};
use flyermap_identity::{Art, Grant, OrgId};

/// What a start brings: the Aktion as the screens see it and what the server grants this device.
#[derive(Clone, Debug, PartialEq)]
pub struct Boot {
    pub world: World,
    /// The grants of the session; the screens ask `flyermap_identity::decide` with them (the server still decides every write).
    pub grants: Vec<Grant>,
    pub org: OrgId,
}

/// The address of one unit of map data: a Gebiet, or one part of a big one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackRef {
    pub gebiet: String,
    pub part: Option<usize>,
}

/// A Gebiet to store: a new one (`id` is `None`) or a changed one.
#[derive(Clone, Debug, PartialEq)]
pub struct GebietDraft {
    pub id: Option<String>,
    pub name: String,
    pub gruppe: Option<String>,
    pub art: Art,
    pub ring: Vec<LngLat>,
}

/// A device that got in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Joined {
    /// The name the server shows for the person ("Gast 4", or the account's name).
    pub label: String,
    pub guest: bool,
    pub aktion_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignIn {
    Passkey,
    Password { name: String, password: String },
    /// The six digits of the second factor, after a password.
    Totp { code: String },
}

//! The derived pack: the engine's network of a Gebiet (or one part of a big one), as bytes a device loads without deriving.
//!
//! The payload is `bincode(Network)`, exactly the blob the engine's `session_export_last` writes and `session_add_blob` reads, in the
//! engine's fixed field order (vectors and ordered maps only, no hash maps), so one input gives one payload. The payload is named by
//! its hash; the file is head + gzip(payload) (see `header` for the layout and `seal` for the check).
use super::{
    error::DerivedError,
    hash,
    header::{Counts, Header, Kind},
    seal::{self, Meta},
};
use crate::{normalize::RawOsm, plan::Cell, plan::LngLat};
use flyermap_engine::model::Network;

/// The address of a pack: the name is its content, so the bytes behind it never change and may be cached for ever.
pub const PACK_PREFIX: &str = "d/";

/// A pack, sealed: the bytes to store, the name they are stored under and the head they carry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DerivedPack {
    pub bytes: Vec<u8>,
    /// 32 hex characters: the hash of the payload.
    pub hash: String,
    pub header: Header,
}

/// Where a pack lives in storage and under which URL: `d/<hash>`.
pub fn address(pack: &DerivedPack) -> String {
    format!("{PACK_PREFIX}{}", pack.hash)
}

fn counts_of(network: &Network) -> Result<Counts, DerivedError> {
    let count = |n: usize| u32::try_from(n).map_err(|_| DerivedError::TooLarge);
    Ok(Counts {
        segments: count(network.segments.len())?,
        visible_segments: count(network.segments.iter().filter(|s| s.visible).count())?,
        houses: count(network.houses.len())?,
    })
}

/// The bytes of a network as the engine writes and reads them.
pub(crate) fn encode_network(network: &Network) -> Result<Vec<u8>, DerivedError> {
    bincode::serialize(network).map_err(|_| DerivedError::Payload)
}

pub(crate) fn decode_network(payload: &[u8]) -> Result<Network, DerivedError> {
    bincode::deserialize(payload).map_err(|_| DerivedError::Payload)
}

/// Seals a payload that is already `bincode(Network)`.
pub(crate) fn from_payload(payload: &[u8], counts: Counts) -> Result<DerivedPack, DerivedError> {
    let content = hash::of(payload);
    let meta = Meta { kind: Kind::Pack, engine_version: flyermap_engine::ENGINE_VERSION, counts, content, base: hash::NONE };
    let sealed = seal::seal(&meta, payload, super::body::LEVEL)?;
    Ok(DerivedPack { bytes: sealed.bytes, hash: hash::hex(&content), header: sealed.header })
}

/// Seals a network that is already derived.
pub fn pack_network(network: &Network) -> Result<DerivedPack, DerivedError> {
    from_payload(&encode_network(network)?, counts_of(network)?)
}

fn check_ring(ring: &[LngLat]) -> Result<(), DerivedError> {
    if ring.len() < 3 || ring.iter().any(|p| !p[0].is_finite() || !p[1].is_finite()) {
        return Err(DerivedError::BadRing);
    }
    Ok(())
}

/// Derives the network of a Gebiet (`cell`: one part of a big one) from its cleaned map data and seals it. `engine_version` is the engine the
/// caller expects to derive with (`ENGINE_VERSION`); a build with another engine refuses rather than write a pack under a wrong label.
pub fn derive_pack(raw: &RawOsm, ring: &[LngLat], cell: Option<Cell>, engine_version: &str) -> Result<DerivedPack, DerivedError> {
    let json = serde_json::to_vec(raw).map_err(|_| DerivedError::RawRejected)?;
    derive_pack_json(&json, ring, cell, engine_version)
}

/// The same from the raw pack's JSON (what `decode` of a stored raw pack gives), without building the typed form first.
pub fn derive_pack_json(raw_json: &[u8], ring: &[LngLat], cell: Option<Cell>, engine_version: &str) -> Result<DerivedPack, DerivedError> {
    if engine_version != flyermap_engine::ENGINE_VERSION {
        return Err(DerivedError::EngineAsked { asked: engine_version.to_string(), built: flyermap_engine::ENGINE_VERSION.to_string() });
    }
    check_ring(ring)?;
    let parsed = flyermap_engine::parse_raw(raw_json).map_err(|_| DerivedError::RawRejected)?;
    pack_network(&flyermap_engine::derive_restricted(&parsed, ring, cell))
}

impl DerivedPack {
    /// Takes bytes from storage or the network: every check of `verify`, and the file must be a pack. The payload is not inflated here.
    pub fn from_bytes(bytes: Vec<u8>) -> Result<DerivedPack, DerivedError> {
        let header = seal::verify(&bytes)?;
        if header.kind != Kind::Pack {
            return Err(DerivedError::WrongKind);
        }
        Ok(DerivedPack { hash: header.content_hex(), header, bytes })
    }

    /// The inflated payload, checked against the name.
    pub fn payload(&self) -> Result<Vec<u8>, DerivedError> {
        seal::unseal(&self.bytes).map(|(_, payload)| payload)
    }

    /// The network inside, decoded. Its size must be what the head says.
    pub fn network(&self) -> Result<Network, DerivedError> {
        let network = decode_network(&self.payload()?)?;
        if counts_of(&network)? != self.header.counts {
            return Err(DerivedError::Payload);
        }
        Ok(network)
    }
}

//! Applying a delta to the pack it was made against. Both ends are checked by hash: the base the delta names must be the one at hand, and
//! what comes out must be the content the delta promises. Nothing is trusted because it decoded.
use super::{
    file::{Body, Delta},
    script::build,
};
use crate::derived::{
    error::DerivedError,
    hash,
    header::Counts,
    pack::{decode_network, encode_network, from_payload, DerivedPack},
    seal,
};
use flyermap_engine::model::Network;

/// The new payload (`bincode(Network)`, hash-checked) from the old payload and a delta: what a device hands to the engine's
/// `session_add_blob` after an update, without sealing anything again.
pub fn apply_to_payload(old_payload: &[u8], delta: &Delta) -> Result<Vec<u8>, DerivedError> {
    rebuild(old_payload, delta).map(|(payload, _)| payload)
}

/// The new pack from the old one and a delta.
pub fn apply(old: &DerivedPack, delta: &Delta) -> Result<DerivedPack, DerivedError> {
    if old.header.content != delta.header.base {
        return Err(DerivedError::BaseMismatch);
    }
    let (payload, counts) = rebuild(&old.payload()?, delta)?;
    from_payload(&payload, counts)
}

fn rebuild(old_payload: &[u8], delta: &Delta) -> Result<(Vec<u8>, Counts), DerivedError> {
    let promised = &delta.header;
    if hash::of(old_payload) != promised.base {
        return Err(DerivedError::BaseMismatch);
    }
    let old = decode_network(old_payload)?;
    let (_, body) = seal::unseal(&delta.bytes)?;
    let body: Body = bincode::deserialize(&body).map_err(|_| DerivedError::Payload)?;
    let network = Network {
        segments: build(&old.segments, &body.segments, promised.counts.segments as usize)?,
        houses: build(&old.houses, &body.houses, promised.counts.houses as usize)?,
        diagnostics: body.diagnostics,
    };
    let payload = encode_network(&network)?;
    let visible = network.segments.iter().filter(|s| s.visible).count();
    if hash::of(&payload) != promised.content || visible != promised.counts.visible_segments as usize {
        return Err(DerivedError::DeltaMismatch);
    }
    Ok((payload, promised.counts))
}

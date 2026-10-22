//! Making a delta between two packs of the same Gebiet.
use super::{
    file::{Body, Delta},
    ranges::ranges,
    script::script,
};
use crate::derived::{
    body::LEVEL,
    error::DerivedError,
    header::Kind,
    pack::{decode_network, DerivedPack},
    seal::{self, Meta},
};

/// A delta that would be larger than this share of the new pack (in stored bytes, percent) is not worth sending: the device gets the pack.
pub const REPLACE_ABOVE_PERCENT: usize = 60;

/// The delta from `old` to `new`, or `None` when it would be more than `REPLACE_ABOVE_PERCENT` of the new pack's size. Things are matched by
/// their ids (segments and houses carry stable ones) and compared by their bytes, so an unchanged street piece or house costs a few bytes
/// however big the Gebiet is.
pub fn diff(old: &DerivedPack, new: &DerivedPack) -> Result<Option<Delta>, DerivedError> {
    let ((_, old_payload), (_, new_payload)) = (seal::unseal(&old.bytes)?, seal::unseal(&new.bytes)?);
    let (old_net, new_net) = (decode_network(&old_payload)?, decode_network(&new_payload)?);
    let (at_old, at_new) = (ranges(&old_net, &old_payload)?, ranges(&new_net, &new_payload)?);
    let body = Body {
        segments: script(
            &old_net.segments,
            &new_net.segments,
            |s| s.id.as_str(),
            |j, i| old_payload[at_old.segments[j].clone()] == new_payload[at_new.segments[i].clone()],
        ),
        houses: script(
            &old_net.houses,
            &new_net.houses,
            |h| h.id.as_str(),
            |j, i| old_payload[at_old.houses[j].clone()] == new_payload[at_new.houses[i].clone()],
        ),
        diagnostics: new_net.diagnostics,
    };
    let payload = bincode::serialize(&body).map_err(|_| DerivedError::Payload)?;
    let meta = Meta {
        kind: Kind::Delta,
        engine_version: flyermap_engine::ENGINE_VERSION,
        counts: new.header.counts,
        content: new.header.content,
        base: old.header.content,
    };
    let sealed = seal::seal(&meta, &payload, LEVEL)?;
    if sealed.bytes.len() * 100 > new.bytes.len() * REPLACE_ABOVE_PERCENT {
        return Ok(None);
    }
    Ok(Some(Delta { bytes: sealed.bytes, header: sealed.header }))
}

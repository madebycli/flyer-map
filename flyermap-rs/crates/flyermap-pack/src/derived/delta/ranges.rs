//! Where each segment and house sits inside a payload, so two payloads can be compared thing by thing without encoding anything again.
//!
//! A payload is `bincode(Network)`: the segments (a u64 count, then each), the houses (a u64 count, then each), the diagnostics. Each thing's
//! size is asked of bincode itself, and the sizes must add up to the payload's length exactly; if the layout were not what is assumed here,
//! that check fails instead of the comparison going wrong.
use super::super::error::DerivedError;
use flyermap_engine::model::Network;
use std::ops::Range;

const COUNT: usize = 8;

pub struct Ranges {
    pub segments: Vec<Range<usize>>,
    pub houses: Vec<Range<usize>>,
}

fn run<T: serde::Serialize>(things: &[T], mut at: usize) -> Result<(Vec<Range<usize>>, usize), DerivedError> {
    let mut out = Vec::with_capacity(things.len());
    for thing in things {
        let size = bincode::serialized_size(thing).map_err(|_| DerivedError::Payload)? as usize;
        out.push(at..at + size);
        at += size;
    }
    Ok((out, at))
}

pub fn ranges(network: &Network, payload: &[u8]) -> Result<Ranges, DerivedError> {
    let (segments, at) = run(&network.segments, COUNT)?;
    let (houses, at) = run(&network.houses, at + COUNT)?;
    let end = at + bincode::serialized_size(&network.diagnostics).map_err(|_| DerivedError::Payload)? as usize;
    if end != payload.len() {
        return Err(DerivedError::Payload);
    }
    Ok(Ranges { segments, houses })
}

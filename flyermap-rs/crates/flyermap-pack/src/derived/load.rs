//! The device side: a derived pack straight into an engine session, no deriving. This is the path `session_add_blob` takes in the browser's
//! WebAssembly (decode the blob, merge it, answer with the slim network); here the same steps run as a library call, so the tests can hold
//! the result against a session that derived the same data itself.
//!
//! In the browser the three steps before the engine are `fetch` → cut the first `HEADER_LEN` bytes off → `DecompressionStream('gzip')`, and
//! what comes out is the blob `session_add_blob` takes as it is.
use super::{
    error::DerivedError,
    header::{Header, Kind},
    pack::{decode_network, DerivedPack},
    seal,
};
use flyermap_engine::{model::Network, model::SlimNetwork, Session};

/// What a load tells the interface: the head of the pack and the slim network (everything but the coordinates), as `session_add_blob` answers.
pub struct Loaded {
    pub header: Header,
    pub slim: SlimNetwork,
}

/// A pack's head and network, after every check: the file (`verify`), the inflated payload against its name, the size against the head.
pub fn load_network(bytes: &[u8]) -> Result<(Header, Network), DerivedError> {
    let (header, payload) = seal::unseal(bytes)?;
    if header.kind != Kind::Pack {
        return Err(DerivedError::WrongKind);
    }
    let network = decode_network(&payload)?;
    let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    let counts = &header.counts;
    if count(network.segments.len()) != counts.segments || count(network.houses.len()) != counts.houses {
        return Err(DerivedError::Payload);
    }
    Ok((header, network))
}

/// Merges a pack into the session (first Area wins, as for a derived one) and returns what the interface keeps.
pub fn load_into(session: &mut Session, bytes: &[u8]) -> Result<Loaded, DerivedError> {
    let (header, network) = load_network(bytes)?;
    session.add(&network);
    Ok(Loaded { header, slim: flyermap_engine::slim(&network) })
}

impl DerivedPack {
    /// `load_into` for a pack at hand.
    pub fn load_into(&self, session: &mut Session) -> Result<Loaded, DerivedError> {
        load_into(session, &self.bytes)
    }
}

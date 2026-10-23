//! The mock's map data of a Gebiet: the synthetic neighbourhood in the Gebiet's box, cleaned and packed exactly like a real answer.
use super::synth;
use crate::model::Gebiet;
use flyermap_pack::{encode, normalize, padded_bbox};

/// The gzip bytes of the pack. A Gebiet without a ring gets an empty pack (the engine then shows nothing, which is what it should).
pub fn bytes(gebiet: &Gebiet) -> Vec<u8> {
    let bbox = padded_bbox(&gebiet.ring, 30.0);
    let answer = synth::overpass(bbox, &gebiet.id);
    match normalize(&answer) {
        Ok((raw, _)) => encode(&raw),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_identity::Art;

    #[test]
    fn a_pack_opens_and_holds_streets_and_houses() {
        let g = Gebiet {
            id: "g1".into(),
            name: "G".into(),
            gruppe: None,
            art: Art::Austeilen,
            ring: vec![[13.0, 51.2], [13.004, 51.2], [13.004, 51.2025], [13.0, 51.2025], [13.0, 51.2]],
            writable: true,
            pack_version: Some(1),
            color: "#000000".into(),
        };
        let json = flyermap_pack::decode(&bytes(&g)).expect("gzip of JSON");
        assert!(json["ways"].as_array().is_some_and(|w| w.len() >= 5));
        assert!(json["buildings"].as_array().is_some_and(|b| b.len() > 40));
    }
}

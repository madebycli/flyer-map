//! The derived pack: the same input gives the same bytes and name, damage of any kind is refused, and what is inside is what the engine derives.
mod support;
use flyermap_pack::derived::{address, derive_pack, derive_pack_json, verify, DerivedError, DerivedPack, Kind, FORMAT, HEADER_LEN};
use flyermap_pack::{encode, ENGINE_VERSION};
use support::{city::city, pack_of_city, raw_of};

#[test]
fn the_same_input_gives_the_same_bytes_and_name() {
    let c = city(4);
    let first = pack_of_city(&c);
    for _ in 0..3 {
        let again = pack_of_city(&c);
        assert_eq!(again.bytes, first.bytes);
        assert_eq!(again.hash, first.hash);
    }
    // another thread, another allocator state
    let (answer, ring) = (c.answer.clone(), c.ring.clone());
    let elsewhere = std::thread::spawn(move || support::pack_of(&answer, &ring)).join().unwrap();
    assert_eq!(elsewhere, first);
    // the typed form and the JSON form of the same data are the same pack
    let json = serde_json::to_vec(&raw_of(&c.answer)).unwrap();
    assert_eq!(derive_pack_json(&json, &c.ring, None, ENGINE_VERSION).unwrap(), first);
    assert_eq!(first.hash.len(), 32);
    assert_eq!(address(&first), format!("d/{}", first.hash));
}

/// The name of a small, fixed synthetic city. A different name means the engine's output (or the bincode layout) changed: that has to be
/// on purpose, and the TypeScript differential tests (`npm test`) decide whether the engine may change; then this line is updated.
#[test]
fn the_name_of_a_known_city_does_not_drift() {
    assert_eq!(pack_of_city(&city(3)).hash, "01cb433c3514c22aac50941ec83f1f27", "pin: see the comment above");
}

#[test]
fn the_head_says_what_is_inside() {
    let c = city(3);
    let pack = pack_of_city(&c);
    let h = &pack.header;
    assert_eq!((h.format, h.kind, h.engine_version.as_str()), (FORMAT, Kind::Pack, ENGINE_VERSION));
    assert_eq!(h.counts.houses as usize, c.houses);
    assert!(h.counts.visible_segments <= h.counts.segments && h.counts.segments > 0);
    assert_eq!(h.payload_len as usize, pack.payload().unwrap().len());
    assert_eq!(&pack.bytes[..4], b"FM6D");
    // after the head comes a plain gzip stream
    assert_eq!(&pack.bytes[HEADER_LEN..HEADER_LEN + 3], &[0x1f, 0x8b, 8]);
    assert_eq!(verify(&pack.bytes).unwrap(), pack.header);
    assert_eq!(DerivedPack::from_bytes(pack.bytes.clone()).unwrap(), pack);
}

#[test]
fn the_network_inside_is_what_the_engine_derives() {
    let c = city(3);
    let pack = pack_of_city(&c);
    let raw_json = serde_json::to_vec(&raw_of(&c.answer)).unwrap();
    let ring_json = serde_json::to_vec(&c.ring).unwrap();
    let engine_json = flyermap_engine::derive_json(&raw_json, Some(&ring_json), None).unwrap();
    assert_eq!(serde_json::to_vec(&pack.network().unwrap()).unwrap(), engine_json, "same bytes as the engine's own JSON path");
}

#[test]
fn every_flipped_bit_of_a_probe_is_refused() {
    let pack = pack_of_city(&city(1));
    assert!(pack.bytes.len() < 20_000, "a probe small enough to flip every bit: {} bytes", pack.bytes.len());
    for byte in 0..pack.bytes.len() {
        for bit in 0..8 {
            let mut bad = pack.bytes.clone();
            bad[byte] ^= 1 << bit;
            assert!(verify(&bad).is_err(), "byte {byte} bit {bit}");
            assert!(DerivedPack::from_bytes(bad).is_err(), "byte {byte} bit {bit}");
        }
    }
}

#[test]
fn cut_and_foreign_files_are_refused_by_name() {
    let pack = pack_of_city(&city(1));
    for cut in 0..pack.bytes.len() {
        assert!(verify(&pack.bytes[..cut]).is_err(), "cut at {cut}");
    }
    let mut longer = pack.bytes.clone();
    longer.push(0);
    assert!(verify(&longer).is_err());
    assert_eq!(verify(b"{\"elements\":[]}").unwrap_err(), DerivedError::NotDerived);
    // the raw pack of today is a gzip, not a derived pack
    assert_eq!(verify(&encode(&raw_of(&city(1).answer))).unwrap_err(), DerivedError::NotDerived);
}

#[test]
fn a_newer_format_is_refused_cleanly() {
    let mut bytes = pack_of_city(&city(1)).bytes;
    bytes[4] = 2;
    assert_eq!(verify(&bytes).unwrap_err(), DerivedError::TooNew { found: 2, supported: FORMAT });
}

#[test]
fn deriving_refuses_what_it_cannot_do() {
    let c = city(1);
    let raw = raw_of(&c.answer);
    assert!(matches!(derive_pack(&raw, &c.ring, None, "v0.1"), Err(DerivedError::EngineAsked { .. })));
    assert_eq!(derive_pack(&raw, &c.ring[..2], None, ENGINE_VERSION).unwrap_err(), DerivedError::BadRing);
    assert_eq!(derive_pack_json(b"{\"ways\":1}", &c.ring, None, ENGINE_VERSION).unwrap_err(), DerivedError::RawRejected);
}

#[test]
fn a_delta_is_not_a_pack_and_a_pack_is_not_a_delta() {
    use flyermap_pack::derived::{diff, Delta};
    let c = city(6);
    let (edited, _) = support::city::edit(&c.answer, 30, 0, 7);
    let (a, b) = (pack_of_city(&c), support::pack_of(&edited, &c.ring));
    let delta = diff(&a, &b).unwrap().expect("a small edit gives a delta");
    assert_eq!(DerivedPack::from_bytes(delta.bytes.clone()).unwrap_err(), DerivedError::WrongKind);
    assert_eq!(Delta::from_bytes(a.bytes).unwrap_err(), DerivedError::WrongKind);
}

//! Updates as a difference: `apply(old, diff(old, new)) == new` for random edits, both ends checked by hash, damage refused, and a change
//! that is not small is not sent as a delta.
mod support;
use flyermap_pack::derived::{apply, apply_to_payload, derive_pack_json, diff, Delta, DerivedError, DerivedPack, REPLACE_ABOVE_PERCENT};
use flyermap_pack::ENGINE_VERSION;
use support::city::{city, edit, Rng};
use support::{pack_of, pack_of_city};

#[test]
fn a_delta_applied_to_the_old_pack_is_the_new_pack() {
    let c = city(6);
    let old = pack_of_city(&c);
    let mut rng = Rng::new(99);
    let (mut sent, mut replaced) = (0, 0);
    for round in 0..16u64 {
        let (per_mille, streets) = [(5, 0), (10, 0), (30, 1), (100, 0), (100, 3), (400, 2)][rng.below(6)];
        let (answer, edits) = edit(&c.answer, per_mille, streets, round);
        let new = pack_of(&answer, &c.ring);
        match diff(&old, &new).unwrap() {
            Some(delta) => {
                sent += 1;
                let rebuilt = apply(&old, &delta).unwrap();
                assert_eq!(rebuilt.bytes, new.bytes, "round {round} {edits:?}");
                assert_eq!(rebuilt.hash, new.hash);
                assert_eq!(apply_to_payload(&old.payload().unwrap(), &delta).unwrap(), new.payload().unwrap());
                assert_eq!((delta.from_hash(), delta.to_hash()), (old.hash.clone(), new.hash.clone()));
                assert_eq!(delta.address(), format!("x/{}/{}", old.hash, new.hash));
                assert_eq!(delta.header.counts, new.header.counts);
                assert!(delta.bytes.len() * 100 <= new.bytes.len() * REPLACE_ABOVE_PERCENT);
                // what comes over the wire is the file, not the value in memory
                assert_eq!(apply(&old, &Delta::from_bytes(delta.bytes.clone()).unwrap()).unwrap(), new);
            }
            None => replaced += 1,
        }
    }
    assert!(sent >= 4, "small edits must give deltas ({sent} of 16)");
    println!("{sent} deltas, {replaced} replaced by the pack");
}

#[test]
fn deltas_chain_and_an_unchanged_gebiet_is_a_few_bytes() {
    let c = city(6);
    let (a, (answer_b, _)) = (pack_of_city(&c), edit(&c.answer, 20, 0, 1));
    let b = pack_of(&answer_b, &c.ring);
    let (answer_c, _) = edit(&answer_b, 20, 1, 2);
    let d = pack_of(&answer_c, &c.ring);
    let (ab, bd) = (diff(&a, &b).unwrap().unwrap(), diff(&b, &d).unwrap().unwrap());
    assert_eq!(apply(&apply(&a, &ab).unwrap(), &bd).unwrap(), d);
    let same = diff(&a, &a).unwrap().unwrap();
    assert!(same.bytes.len() < 400, "{} bytes for no change", same.bytes.len());
    assert_eq!(apply(&a, &same).unwrap(), a);
}

#[test]
fn a_change_that_is_not_small_is_not_a_delta() {
    let (small, big) = (city(3), city(7));
    assert!(diff(&pack_of_city(&small), &pack_of_city(&big)).unwrap().is_none(), "another city is a new pack");
    let c = city(6);
    let (answer, _) = edit(&c.answer, 900, 20, 3);
    assert!(diff(&pack_of_city(&c), &pack_of(&answer, &c.ring)).unwrap().is_none(), "nine in ten houses edited");
}

#[test]
fn both_ends_are_checked_by_hash() {
    let c = city(6);
    let (old, (answer, _)) = (pack_of_city(&c), edit(&c.answer, 30, 0, 5));
    let new = pack_of(&answer, &c.ring);
    let delta = diff(&old, &new).unwrap().unwrap();
    // the wrong base
    let other = pack_of(&edit(&c.answer, 30, 0, 6).0, &c.ring);
    assert_eq!(apply(&other, &delta).unwrap_err(), DerivedError::BaseMismatch);
    assert_eq!(apply_to_payload(&other.payload().unwrap(), &delta).unwrap_err(), DerivedError::BaseMismatch);
    assert_eq!(apply(&new, &delta).unwrap_err(), DerivedError::BaseMismatch);
    // a different payload with the right name is not accepted either: swap the old pack's body for the other one's
    let mut fake = old.clone();
    fake.bytes = other.bytes.clone();
    assert_eq!(apply(&fake, &delta).unwrap_err(), DerivedError::BaseMismatch);
}

#[test]
fn every_flipped_bit_of_a_small_delta_is_refused() {
    let c = city(2);
    let (answer, _) = edit(&c.answer, 300, 0, 4);
    let delta = diff(&pack_of_city(&c), &pack_of(&answer, &c.ring)).unwrap().expect("a delta");
    assert!(delta.bytes.len() < 12_000, "{} bytes", delta.bytes.len());
    for byte in 0..delta.bytes.len() {
        for bit in 0..8 {
            let mut bad = delta.bytes.clone();
            bad[byte] ^= 1 << bit;
            assert!(Delta::from_bytes(bad).is_err(), "byte {byte} bit {bit}");
        }
    }
}

#[test]
fn an_empty_gebiet_and_a_first_house_work_too() {
    let ring = vec![[-30.0, 45.0], [-29.99, 45.0], [-29.99, 45.01], [-30.0, 45.01]];
    let empty = derive_pack_json(br#"{"ways":[],"buildings":[],"addresses":[]}"#, &ring, None, ENGINE_VERSION).unwrap();
    assert_eq!(empty.header.counts.houses, 0);
    let c = city(1);
    let filled = pack_of_city(&c);
    for (a, b) in [(&empty, &empty), (&empty, &filled), (&filled, &empty)] {
        if let Some(delta) = diff(a, b).unwrap() {
            assert_eq!(&apply(a, &delta).unwrap(), b);
        }
    }
    let pack: DerivedPack = filled;
    assert!(pack.network().unwrap().houses.len() > 4);
}

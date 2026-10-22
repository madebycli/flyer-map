//! Shared by the derived-pack tests and `examples/derived_bench.rs`.
#![allow(dead_code)]
pub mod city;

use city::City;
use flyermap_pack::derived::{derive_pack, DerivedPack};
use flyermap_pack::{normalize, RawOsm, ENGINE_VERSION};
use serde_json::Value;

pub fn raw_of(answer: &Value) -> RawOsm {
    normalize(answer).expect("the synthetic answer is an element list").0
}

pub fn pack_of(answer: &Value, ring: &[[f64; 2]]) -> DerivedPack {
    derive_pack(&raw_of(answer), ring, None, ENGINE_VERSION).expect("derives")
}

pub fn pack_of_city(city: &City) -> DerivedPack {
    pack_of(&city.answer, &city.ring)
}
